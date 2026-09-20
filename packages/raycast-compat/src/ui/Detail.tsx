import React from 'react';
import { ActionPanel, type ActionDescriptor } from './ActionPanel';
import { open } from '../navigation';
import { Color } from '../constants';

// ── Markdown Formatter ────────────────────────────────────────────────────────
function renderMarkdown(md: string) {
  if (!md) return null;

  const lines = md.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks (```)
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${i}`}
            style={{
              background: 'var(--bg-card, rgba(255, 255, 255, 0.05))',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
              borderRadius: '6px',
              padding: '12px 14px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '13px',
              lineHeight: '1.45',
              overflowX: 'auto',
              margin: '8px 0',
              color: 'var(--text-primary, #ffffff)',
            }}
          >
            <code>{codeBuffer.join('\n')}</code>
          </pre>,
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      elements.push(
        <h1
          key={`h1-${i}`}
          style={{
            fontSize: '20px',
            fontWeight: 700,
            margin: '16px 0 8px 0',
            color: 'var(--text-primary, #ffffff)',
          }}
        >
          {formatInline(line.slice(2))}
        </h1>,
      );
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2
          key={`h2-${i}`}
          style={{
            fontSize: '17px',
            fontWeight: 600,
            margin: '14px 0 6px 0',
            color: 'var(--text-primary, #ffffff)',
          }}
        >
          {formatInline(line.slice(3))}
        </h2>,
      );
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3
          key={`h3-${i}`}
          style={{
            fontSize: '15px',
            fontWeight: 600,
            margin: '12px 0 4px 0',
            color: 'var(--text-primary, #ffffff)',
          }}
        >
          {formatInline(line.slice(4))}
        </h3>,
      );
      continue;
    }

    // Blockquotes
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote
          key={`bq-${i}`}
          style={{
            borderLeft: '3px solid var(--accent-primary, #3b82f6)',
            paddingLeft: '12px',
            margin: '8px 0',
            color: 'var(--text-secondary, #94a3b8)',
            fontStyle: 'italic',
          }}
        >
          {formatInline(line.slice(2))}
        </blockquote>,
      );
      continue;
    }

    // Unordered lists
    if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <li
          key={`li-${i}`}
          style={{
            marginLeft: '20px',
            marginBottom: '4px',
            color: 'var(--text-primary, #ffffff)',
            lineHeight: '1.5',
          }}
        >
          {formatInline(line.slice(2))}
        </li>,
      );
      continue;
    }

    // Horizontal rule
    if (line === '---' || line === '***' || line === '___') {
      elements.push(
        <hr
          key={`hr-${i}`}
          style={{
            border: 'none',
            borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
            margin: '16px 0',
          }}
        />,
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={`empty-${i}`} style={{ height: '8px' }} />);
      continue;
    }

    // Paragraph
    elements.push(
      <p
        key={`p-${i}`}
        style={{
          margin: '4px 0',
          lineHeight: '1.55',
          color: 'var(--text-primary, #ffffff)',
          fontSize: '14px',
        }}
      >
        {formatInline(line)}
      </p>,
    );
  }

  return <>{elements}</>;
}

function formatInline(text: string): React.ReactNode {
  // Simple inline bold, code, and link parsing
  const parts = text.split(/(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\))/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          style={{
            background: 'var(--bg-card, rgba(255, 255, 255, 0.1))',
            padding: '2px 5px',
            borderRadius: '4px',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '12px',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      return (
        <a
          key={idx}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            void open(href);
          }}
          style={{
            color: 'var(--accent-primary, #3b82f6)',
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          {label}
        </a>
      );
    }
    return part;
  });
}

// ── Detail.Metadata Components ────────────────────────────────────────────────
export interface DetailMetadataProps {
  children?: React.ReactNode;
}

export function DetailMetadata({ children }: DetailMetadataProps) {
  return (
    <aside
      style={{
        width: '260px',
        borderLeft: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
        background: 'var(--bg-surface, rgba(0, 0, 0, 0.2))',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        overflowY: 'auto',
      }}
    >
      {children}
    </aside>
  );
}

export interface DetailMetadataLabelProps {
  title: string;
  text?: string;
  icon?: string | { source: string; tintColor?: string };
}

export function DetailMetadataLabel({ title, text, icon }: DetailMetadataLabelProps) {
  let iconNode: React.ReactNode = null;
  if (typeof icon === 'string') {
    iconNode = <span style={{ marginRight: '6px' }}>{icon}</span>;
  } else if (icon && typeof icon === 'object') {
    iconNode = <span style={{ marginRight: '6px', color: icon.tintColor }}>{icon.source}</span>;
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '13px',
      }}
    >
      <span style={{ color: 'var(--text-secondary, #94a3b8)', fontWeight: 500 }}>{title}</span>
      <span
        style={{
          color: 'var(--text-primary, #ffffff)',
          display: 'flex',
          alignItems: 'center',
          textAlign: 'right',
        }}
      >
        {iconNode}
        {text}
      </span>
    </div>
  );
}

export interface DetailMetadataLinkProps {
  title: string;
  target: string;
  text?: string;
}

export function DetailMetadataLink({ title, target, text }: DetailMetadataLinkProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '13px',
      }}
    >
      <span style={{ color: 'var(--text-secondary, #94a3b8)', fontWeight: 500 }}>{title}</span>
      <a
        href={target}
        onClick={(e) => {
          e.preventDefault();
          void open(target);
        }}
        style={{
          color: 'var(--accent-primary, #3b82f6)',
          textDecoration: 'none',
          cursor: 'pointer',
          maxWidth: '150px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {text || target}
      </a>
    </div>
  );
}

export interface DetailMetadataTagListProps {
  title: string;
  children?: React.ReactNode;
}

export function DetailMetadataTagList({ title, children }: DetailMetadataTagListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span
        style={{
          color: 'var(--text-secondary, #94a3b8)',
          fontSize: '12px',
          fontWeight: 500,
        }}
      >
        {title}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{children}</div>
    </div>
  );
}

export interface DetailMetadataTagListItemProps {
  title?: string;
  text?: string;
  color?: string;
  icon?: string;
}

export function DetailMetadataTagListItem({
  title,
  text,
  color,
  icon,
}: DetailMetadataTagListItemProps) {
  const displayText = text || title || '';
  const bgColor = color ? `${color}22` : 'var(--bg-card, rgba(255, 255, 255, 0.1))';
  const textColor = color || 'var(--text-primary, #ffffff)';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 500,
        background: bgColor,
        color: textColor,
        border: color ? `1px solid ${color}44` : '1px solid transparent',
      }}
    >
      {icon && <span style={{ marginRight: '4px' }}>{icon}</span>}
      {displayText}
    </span>
  );
}

export function DetailMetadataSeparator() {
  return (
    <div
      style={{
        height: '1px',
        background: 'var(--border-subtle, rgba(255, 255, 255, 0.1))',
        margin: '4px 0',
      }}
    />
  );
}

// Attach subcomponents
DetailMetadata.Label = DetailMetadataLabel;
DetailMetadata.Link = DetailMetadataLink;
DetailMetadata.TagList = Object.assign(DetailMetadataTagList, {
  Item: DetailMetadataTagListItem,
});
DetailMetadata.Separator = DetailMetadataSeparator;

// ── Detail Main View ──────────────────────────────────────────────────────────
export interface DetailProps {
  markdown?: string;
  isLoading?: boolean;
  navigationTitle?: string;
  metadata?: React.ReactNode;
  actions?: React.ReactNode;
}

export function Detail({
  markdown = '',
  isLoading = false,
  navigationTitle,
  metadata,
  actions,
}: DetailProps) {
  // Extract actions from actions prop if provided
  let primaryAction: ActionDescriptor | undefined;
  let actionList: ActionDescriptor[] = [];

  if (actions && React.isValidElement(actions)) {
    const props = actions.props as any;
    const children = React.Children.toArray(props.children);
    actionList = children
      .map((child: any, idx: number) => {
        if (!child || !child.props) return null;
        return {
          id: child.props.id || child.props.title || `action-${idx}`,
          title: child.props.title || 'Action',
          shortcut: child.props.shortcut,
          icon: child.props.icon,
          onAction: child.props.onAction,
        } as ActionDescriptor;
      })
      .filter(Boolean) as ActionDescriptor[];

    primaryAction = actionList[0];
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-base, #1e1e2e)',
        color: 'var(--text-primary, #ffffff)',
        fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top Navigation Bar if title is present */}
      {navigationTitle && (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
            fontSize: '14px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{navigationTitle}</span>
          {isLoading && (
            <span style={{ fontSize: '12px', color: 'var(--text-secondary, #94a3b8)' }}>
              Loading…
            </span>
          )}
        </div>
      )}

      {/* Main Content Area: Markdown + Metadata Sidebar */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            flex: 1,
            padding: '20px 24px',
            overflowY: 'auto',
          }}
        >
          {isLoading && !markdown ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                color: 'var(--text-secondary, #94a3b8)',
              }}
            >
              Loading content…
            </div>
          ) : (
            renderMarkdown(markdown)
          )}
        </div>

        {metadata}
      </div>

      {/* Bottom Action Bar */}
      {primaryAction && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
            background: 'var(--bg-surface, rgba(0, 0, 0, 0.3))',
            fontSize: '12px',
          }}
        >
          <button
            type="button"
            onClick={() => primaryAction?.onAction?.()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
              background: 'var(--accent-primary, #3b82f6)',
              color: '#ffffff',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {primaryAction.title}
            <kbd
              style={{
                background: 'rgba(0, 0, 0, 0.25)',
                padding: '1px 4px',
                borderRadius: '3px',
                fontSize: '10px',
              }}
            >
              ↵
            </kbd>
          </button>
        </div>
      )}
    </div>
  );
}

// Attach subcomponents to Detail
Detail.Metadata = DetailMetadata;
