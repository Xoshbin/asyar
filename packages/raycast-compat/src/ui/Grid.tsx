import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ActionPanel, type ActionDescriptor } from './ActionPanel';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GridItemProps {
  id?: string;
  title: string;
  subtitle?: string;
  content: string | { source: string; tintColor?: string };
  keywords?: string[];
  actions?: React.ReactNode;
}

export interface GridSectionProps {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export interface GridEmptyViewProps {
  icon?: string | { source: string; tintColor?: string };
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export interface GridDropdownProps {
  tooltip?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (newValue: string) => void;
  children?: React.ReactNode;
}

export interface GridDropdownItemProps {
  title: string;
  value: string;
  icon?: string;
}

export interface GridProps {
  columns?: number;
  aspectRatio?: '1/1' | '16/9' | '4/3' | '3/2';
  fit?: 'cover' | 'contain';
  searchBarPlaceholder?: string;
  searchText?: string;
  onSearchTextChange?: (text: string) => void;
  isLoading?: boolean;
  navigationTitle?: string;
  searchBarAccessory?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

// ── Subcomponents ─────────────────────────────────────────────────────────────
export function GridItem(_props: GridItemProps) {
  return null; // Rendered virtually by parent Grid
}

export function GridSection(_props: GridSectionProps) {
  return null; // Rendered virtually by parent Grid
}

export function GridEmptyView(_props: GridEmptyViewProps) {
  return null; // Rendered virtually by parent Grid
}

export function GridDropdownItem({ title, value }: GridDropdownItemProps) {
  return <option value={value}>{title}</option>;
}

export function GridDropdown({
  tooltip,
  value,
  defaultValue = '',
  onChange,
  children,
}: GridDropdownProps) {
  const [selected, setSelected] = useState(defaultValue);
  const currentVal = value !== undefined ? value : selected;

  return (
    <select
      title={tooltip}
      value={currentVal}
      onChange={(e) => {
        setSelected(e.target.value);
        onChange?.(e.target.value);
      }}
      style={{
        background: 'var(--bg-surface, rgba(255, 255, 255, 0.08))',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
        borderRadius: '6px',
        color: 'var(--text-primary, #ffffff)',
        padding: '4px 8px',
        fontSize: '12px',
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      {children}
    </select>
  );
}

GridDropdown.Item = GridDropdownItem;

// ── Main Grid Component ───────────────────────────────────────────────────────
export function Grid({
  columns = 4,
  aspectRatio = '1/1',
  fit = 'cover',
  searchBarPlaceholder = 'Search…',
  searchText,
  onSearchTextChange,
  isLoading = false,
  navigationTitle,
  searchBarAccessory,
  actions,
  children,
}: GridProps) {
  const [internalQuery, setInternalQuery] = useState('');
  const query = searchText !== undefined ? searchText : internalQuery;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isActionPanelOpen, setIsActionPanelOpen] = useState(false);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Parse Children
  const { sections, emptyView } = useMemo(() => {
    const rawChildren = React.Children.toArray(children);
    const parsedSections: Array<{
      title?: string;
      subtitle?: string;
      items: GridItemProps[];
    }> = [];
    let customEmptyView: GridEmptyViewProps | null = null;

    let standaloneItems: GridItemProps[] = [];

    for (const child of rawChildren) {
      if (!React.isValidElement(child)) continue;

      if (child.type === GridEmptyView) {
        customEmptyView = child.props as GridEmptyViewProps;
      } else if (child.type === GridSection) {
        if (standaloneItems.length > 0) {
          parsedSections.push({ items: standaloneItems });
          standaloneItems = [];
        }
        const sectionProps = child.props as GridSectionProps;
        const sectionItems = React.Children.toArray(sectionProps.children)
          .filter(React.isValidElement)
          .map((c) => (c as React.ReactElement<GridItemProps>).props);
        parsedSections.push({
          title: sectionProps.title,
          subtitle: sectionProps.subtitle,
          items: sectionItems,
        });
      } else if (child.type === GridItem) {
        standaloneItems.push(child.props as GridItemProps);
      }
    }

    if (standaloneItems.length > 0) {
      parsedSections.push({ items: standaloneItems });
    }

    return { sections: parsedSections, emptyView: customEmptyView };
  }, [children]);

  // Filter Items
  const filteredSections = useMemo(() => {
    if (!query.trim()) return sections;
    const lower = query.toLowerCase();

    return sections
      .map((sec) => {
        const filteredItems = sec.items.filter((item) => {
          if (item.title.toLowerCase().includes(lower)) return true;
          if (item.subtitle?.toLowerCase().includes(lower)) return true;
          if (item.keywords?.some((k) => k.toLowerCase().includes(lower))) return true;
          return false;
        });
        return { ...sec, items: filteredItems };
      })
      .filter((sec) => sec.items.length > 0);
  }, [sections, query]);

  const allItems = useMemo(() => filteredSections.flatMap((s) => s.items), [filteredSections]);

  // Clamp selection
  useEffect(() => {
    if (selectedIndex >= allItems.length) {
      setSelectedIndex(Math.max(0, allItems.length - 1));
    }
  }, [allItems.length, selectedIndex]);

  const selectedItem = allItems[selectedIndex];

  // Extract Actions
  const { primaryAction, actionList } = useMemo(() => {
    const itemActionsNode = selectedItem?.actions || actions;
    if (!itemActionsNode || !React.isValidElement(itemActionsNode)) {
      return { primaryAction: undefined, actionList: [] };
    }

    const actionChildren = React.Children.toArray((itemActionsNode.props as any).children);
    const list: ActionDescriptor[] = actionChildren
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

    return { primaryAction: list[0], actionList: list };
  }, [selectedItem, actions]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(allItems.length - 1, prev + 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(allItems.length - 1, prev + columns));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(0, prev - columns));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      primaryAction?.onAction?.();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setIsActionPanelOpen((prev) => !prev);
    }
  };

  const handleSearchChange = (val: string) => {
    setInternalQuery(val);
    onSearchTextChange?.(val);
    setSelectedIndex(0);
  };

  // Aspect ratio calculation
  const ratioMap = {
    '1/1': '100%',
    '16/9': '56.25%',
    '4/3': '75%',
    '3/2': '66.66%',
  };
  const paddingBottom = ratioMap[aspectRatio] || '100%';

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={0}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-base, #1e1e2e)',
        color: 'var(--text-primary, #ffffff)',
        fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
        boxSizing: 'border-box',
        outline: 'none',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Search Bar Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
          background: 'var(--bg-surface, rgba(0, 0, 0, 0.2))',
        }}
      >
        <span style={{ fontSize: '14px', color: 'var(--text-secondary, #94a3b8)' }}>🔍</span>
        <input
          type="text"
          value={query}
          placeholder={searchBarPlaceholder}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary, #ffffff)',
            fontSize: '14px',
          }}
        />
        {isLoading && (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary, #94a3b8)' }}>
            Loading…
          </span>
        )}
        {searchBarAccessory}
      </div>

      {/* Grid Content Area */}
      <div
        ref={gridContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
        }}
      >
        {allItems.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '8px',
              color: 'var(--text-secondary, #94a3b8)',
            }}
          >
            <span style={{ fontSize: '32px' }}>
              {typeof emptyView?.icon === 'string' ? emptyView.icon : '🔍'}
            </span>
            <span
              style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary, #ffffff)' }}
            >
              {emptyView?.title || 'No results found'}
            </span>
            {emptyView?.description && (
              <span style={{ fontSize: '13px' }}>{emptyView.description}</span>
            )}
          </div>
        ) : (
          filteredSections.map((sec, secIdx) => (
            <div key={secIdx} style={{ marginBottom: '20px' }}>
              {sec.title && (
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--text-secondary, #94a3b8)',
                    marginBottom: '10px',
                  }}
                >
                  {sec.title}
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, 1fr)`,
                  gap: '12px',
                }}
              >
                {sec.items.map((item) => {
                  const globalIdx = allItems.indexOf(item);
                  const isSelected = globalIdx === selectedIndex;

                  let imageSource = '';
                  let tintColor: string | undefined;
                  if (typeof item.content === 'string') {
                    imageSource = item.content;
                  } else if (item.content && typeof item.content === 'object') {
                    imageSource = item.content.source;
                    tintColor = item.content.tintColor;
                  }

                  return (
                    <div
                      key={item.id || item.title}
                      onClick={() => setSelectedIndex(globalIdx)}
                      onDoubleClick={() => primaryAction?.onAction?.()}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        background: isSelected
                          ? 'var(--bg-active, rgba(59, 130, 246, 0.15))'
                          : 'var(--bg-card, rgba(255, 255, 255, 0.04))',
                        border: isSelected
                          ? '2px solid var(--accent-primary, #3b82f6)'
                          : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* Image Thumbnail Container */}
                      <div
                        style={{
                          width: '100%',
                          position: 'relative',
                          paddingBottom,
                          background: 'rgba(0, 0, 0, 0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {imageSource.startsWith('http') || imageSource.startsWith('/') ? (
                          <img
                            src={imageSource}
                            alt={item.title}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: '100%',
                              objectFit: fit,
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              position: 'absolute',
                              top: '50%',
                              left: '50%',
                              transform: 'translate(-50%, -50%)',
                              fontSize: '28px',
                              color: tintColor,
                            }}
                          >
                            {imageSource}
                          </span>
                        )}
                      </div>

                      {/* Title & Subtitle */}
                      <div style={{ padding: '8px 10px' }}>
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.title}
                        </div>
                        {item.subtitle && (
                          <div
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-secondary, #94a3b8)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Bottom Action Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 16px',
          borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
          background: 'var(--bg-surface, rgba(0, 0, 0, 0.3))',
          fontSize: '12px',
        }}
      >
        <span style={{ color: 'var(--text-secondary, #94a3b8)' }}>
          {selectedItem ? selectedItem.title : ''}
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {primaryAction && (
            <button
              type="button"
              onClick={() => primaryAction.onAction?.()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                borderRadius: '5px',
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
                  padding: '1px 3px',
                  borderRadius: '3px',
                }}
              >
                ↵
              </kbd>
            </button>
          )}
          {actionList.length > 1 && (
            <button
              type="button"
              onClick={() => setIsActionPanelOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                borderRadius: '5px',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
                background: 'transparent',
                color: 'var(--text-secondary, #94a3b8)',
                cursor: 'pointer',
              }}
            >
              Actions
              <kbd
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  padding: '1px 3px',
                  borderRadius: '3px',
                }}
              >
                ⌘K
              </kbd>
            </button>
          )}
        </div>
      </div>

      {/* ⌘K Action Palette Modal */}
      {isActionPanelOpen && (
        <div
          onClick={() => setIsActionPanelOpen(false)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '380px',
              maxHeight: '360px',
              background: 'var(--bg-card, #262738)',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
              borderRadius: '10px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                fontSize: '13px',
                fontWeight: 600,
                borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
              }}
            >
              Actions
            </div>
            <div style={{ overflowY: 'auto', padding: '6px' }}>
              {actionList.map((action, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    action.onAction?.();
                    setIsActionPanelOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{action.title}</span>
                  {idx === 0 && (
                    <kbd
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        padding: '1px 4px',
                        borderRadius: '3px',
                      }}
                    >
                      ↵
                    </kbd>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Attach subcomponents to Grid
Grid.Item = GridItem;
Grid.Section = GridSection;
Grid.EmptyView = GridEmptyView;
Grid.Dropdown = GridDropdown;
