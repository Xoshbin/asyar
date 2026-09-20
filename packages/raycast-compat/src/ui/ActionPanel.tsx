import React, { createContext, useContext, useEffect, useState } from 'react';
import { Clipboard } from '../clipboard';
import { open } from '../navigation';
import type { Keyboard } from '../constants';

export interface ActionDescriptor {
  id: string;
  title: string;
  icon?: any;
  onAction?: () => void | Promise<void>;
  shortcut?: Keyboard.Shortcut;
  isPrimary?: boolean;
}

export interface ActionProps {
  title: string;
  icon?: any;
  onAction?: () => void | Promise<void>;
  shortcut?: Keyboard.Shortcut;
}

export function Action(props: ActionProps): React.ReactElement {
  return (
    <button
      type="button"
      className="asyar-action-item"
      onClick={() => props.onAction?.()}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        color: 'var(--text-primary, #ffffff)',
        fontSize: '13px',
        cursor: 'pointer',
        borderRadius: '6px',
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {props.icon && <span>{String(props.icon)}</span>}
        <span>{props.title}</span>
      </span>
      {props.shortcut && (
        <span
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary, #94a3b8)',
            fontFamily: 'ui-monospace, monospace',
            padding: '2px 6px',
            background: 'var(--bg-card, rgba(255, 255, 255, 0.06))',
            borderRadius: '4px',
          }}
        >
          {props.shortcut.modifiers.join('+')} {props.shortcut.key.toUpperCase()}
        </span>
      )}
    </button>
  );
}

export namespace Action {
  export interface CopyToClipboardProps {
    content: string | number;
    title?: string;
    shortcut?: Keyboard.Shortcut;
    onCopy?: () => void;
  }

  export function CopyToClipboard(props: CopyToClipboardProps): React.ReactElement {
    const handleAction = async () => {
      await Clipboard.copy(props.content);
      props.onCopy?.();
    };

    return (
      <Action
        title={props.title ?? 'Copy to Clipboard'}
        icon="📋"
        shortcut={props.shortcut ?? { modifiers: ['cmd'], key: 'c' }}
        onAction={handleAction}
      />
    );
  }

  export interface PasteProps {
    content: string | number;
    title?: string;
    shortcut?: Keyboard.Shortcut;
    onPaste?: () => void;
  }

  export function Paste(props: PasteProps): React.ReactElement {
    const handleAction = async () => {
      await Clipboard.paste(props.content);
      props.onPaste?.();
    };

    return (
      <Action
        title={props.title ?? 'Paste in Active App'}
        icon="📋"
        shortcut={props.shortcut ?? { modifiers: ['cmd', 'shift'], key: 'v' }}
        onAction={handleAction}
      />
    );
  }

  export interface OpenInBrowserProps {
    url: string;
    title?: string;
    shortcut?: Keyboard.Shortcut;
    onOpen?: () => void;
  }

  export function OpenInBrowser(props: OpenInBrowserProps): React.ReactElement {
    const handleAction = async () => {
      await open(props.url);
      props.onOpen?.();
    };

    return (
      <Action
        title={props.title ?? 'Open in Browser'}
        icon="🌐"
        shortcut={props.shortcut ?? { modifiers: ['cmd'], key: 'enter' }}
        onAction={handleAction}
      />
    );
  }

  export interface OpenProps {
    target: string;
    title?: string;
    application?: any;
    onOpen?: () => void;
  }

  export function Open(props: OpenProps): React.ReactElement {
    const handleAction = async () => {
      await open(props.target, props.application);
      props.onOpen?.();
    };

    return <Action title={props.title ?? 'Open'} icon="↗️" onAction={handleAction} />;
  }

  export interface SubmitFormProps {
    title?: string;
    onSubmit?: (values: any) => void;
  }

  export function SubmitForm(props: SubmitFormProps): React.ReactElement {
    return (
      <Action title={props.title ?? 'Submit'} icon="↵" onAction={() => props.onSubmit?.({})} />
    );
  }

  export function Push(props: { title: string; target: React.ReactElement }): React.ReactElement {
    return <Action title={props.title} icon="→" />;
  }

  export function Pop(props: { title?: string }): React.ReactElement {
    return <Action title={props.title ?? 'Back'} icon="←" />;
  }
}

export interface ActionPanelProps {
  title?: string;
  children: React.ReactNode;
}

export function ActionPanel(props: ActionPanelProps): React.ReactElement {
  return (
    <div
      className="asyar-action-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px',
      }}
    >
      {props.title && (
        <div
          style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-secondary, #94a3b8)',
            padding: '4px 8px',
          }}
        >
          {props.title}
        </div>
      )}
      {props.children}
    </div>
  );
}

export namespace ActionPanel {
  export function Section(props: {
    title?: string;
    children: React.ReactNode;
  }): React.ReactElement {
    return (
      <div
        className="asyar-action-section"
        style={{
          borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          paddingTop: '6px',
          marginTop: '6px',
        }}
      >
        {props.title && (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-secondary, #94a3b8)',
              padding: '2px 8px 4px',
            }}
          >
            {props.title}
          </div>
        )}
        {props.children}
      </div>
    );
  }

  export function Submenu(props: {
    title: string;
    icon?: any;
    children: React.ReactNode;
  }): React.ReactElement {
    return (
      <div className="asyar-action-submenu">
        <Action title={props.title} icon={props.icon} />
      </div>
    );
  }
}

/**
 * Extracts action descriptors from an ActionPanel element tree.
 */
export function extractActionsFromElement(element?: React.ReactNode): ActionDescriptor[] {
  if (!element || !React.isValidElement(element)) return [];

  const actions: ActionDescriptor[] = [];

  const traverse = (node: React.ReactNode) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(traverse);
      return;
    }
    if (!React.isValidElement(node)) return;

    const props = node.props as any;
    if (
      node.type === Action ||
      typeof props.content !== 'undefined' ||
      typeof props.url !== 'undefined' ||
      props.onAction
    ) {
      actions.push({
        id: `act_${actions.length}`,
        title: props.title ?? 'Action',
        icon: props.icon,
        onAction:
          props.onAction ??
          (props.content !== undefined
            ? async () => {
                await Clipboard.copy(props.content);
                props.onCopy?.();
              }
            : props.url
              ? async () => {
                  await open(props.url);
                  props.onOpen?.();
                }
              : undefined),
        shortcut: props.shortcut,
        isPrimary: actions.length === 0,
      });
    }

    if (props.children) {
      traverse(props.children);
    }
  };

  traverse(element);
  return actions;
}
