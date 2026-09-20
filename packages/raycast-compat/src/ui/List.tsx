import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { extractActionsFromElement, type ActionDescriptor } from './ActionPanel';

export interface ListItemAccessory {
  text?: string;
  icon?: any;
  tag?: string;
  tooltip?: string;
  date?: Date;
}

export interface ListItemProps {
  id?: string;
  title: string;
  subtitle?: string;
  icon?: any;
  accessories?: ListItemAccessory[];
  actions?: React.ReactNode;
  keywords?: string[];
  detail?: React.ReactNode;
}

export function ListItem(_props: ListItemProps): React.ReactElement | null {
  // Pure declaration component — rendered by List container
  return null;
}

export interface ListSectionProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function ListSection(_props: ListSectionProps): React.ReactElement | null {
  // Pure declaration component — rendered by List container
  return null;
}

export interface ListEmptyViewProps {
  title?: string;
  description?: string;
  icon?: any;
  actions?: React.ReactNode;
}

import { renderIconElement } from './iconUtils';
export { renderIconElement };

export function ListEmptyView(props: ListEmptyViewProps): React.ReactElement {
  return (
    <div
      className="asyar-list-empty"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        color: 'var(--text-secondary, #94a3b8)',
        textAlign: 'center',
        gap: '8px',
      }}
    >
      {props.icon && renderIconElement(props.icon, '32px')}
      {props.title && (
        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary, #ffffff)' }}>
          {props.title}
        </div>
      )}
      {props.description && (
        <div style={{ fontSize: '13px', maxWidth: '320px', lineHeight: 1.4 }}>
          {props.description}
        </div>
      )}
    </div>
  );
}

export interface ListDropdownProps {
  tooltip?: string;
  onChange?: (newValue: string) => void;
  children: React.ReactNode;
}

export function ListDropdown(props: ListDropdownProps): React.ReactElement {
  return (
    <select
      aria-label={props.tooltip ?? 'Filter options'}
      onChange={(e) => props.onChange?.(e.target.value)}
      style={{
        padding: '4px 8px',
        background: 'var(--bg-card, rgba(255, 255, 255, 0.08))',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
        borderRadius: '6px',
        color: 'var(--text-primary, #ffffff)',
        fontSize: '12px',
        cursor: 'pointer',
      }}
    >
      {props.children}
    </select>
  );
}

export namespace ListDropdown {
  export function Item(props: { title: string; value: string }): React.ReactElement {
    return <option value={props.value}>{props.title}</option>;
  }
}

export interface ListProps {
  isLoading?: boolean;
  searchBarPlaceholder?: string;
  searchText?: string;
  onSearchTextChange?: (text: string) => void;
  navigationTitle?: string;
  selectedItemId?: string;
  onSelectionChange?: (id: string | null) => void;
  searchBarAccessory?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

interface FlattenedItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: any;
  accessories?: ListItemAccessory[];
  actions?: React.ReactNode;
  keywords?: string[];
  sectionTitle?: string;
}

export function List(props: ListProps): React.ReactElement {
  const [internalQuery, setInternalQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showPalette, setShowPalette] = useState(false);

  const query = props.searchText !== undefined ? props.searchText : internalQuery;

  const handleQueryChange = (val: string) => {
    if (props.onSearchTextChange) {
      props.onSearchTextChange(val);
    } else {
      setInternalQuery(val);
    }
    setSelectedIndex(0);
  };

  // Collect items, sections, and empty view
  const { items, emptyView } = useMemo(() => {
    const listItems: FlattenedItem[] = [];
    let customEmpty: React.ReactElement | null = null;

    const parseChildren = (nodes: React.ReactNode, currentSection?: string) => {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child)) return;

        if (child.type === ListEmptyView) {
          customEmpty = child;
          return;
        }

        if (child.type === ListSection) {
          const sectionProps = child.props as ListSectionProps;
          parseChildren(sectionProps.children, sectionProps.title);
          return;
        }

        if (child.type === ListItem || (child.props as any).title) {
          const itemProps = child.props as ListItemProps;
          listItems.push({
            id: itemProps.id ?? `item_${listItems.length}`,
            title: itemProps.title,
            subtitle: itemProps.subtitle,
            icon: itemProps.icon,
            accessories: itemProps.accessories,
            actions: itemProps.actions,
            keywords: itemProps.keywords,
            sectionTitle: currentSection,
          });
        }
      });
    };

    parseChildren(props.children);
    return { items: listItems, emptyView: customEmpty };
  }, [props.children]);

  // Filter items matching query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const lower = query.toLowerCase();

    return items.filter((item) => {
      if (item.title.toLowerCase().includes(lower)) return true;
      if (item.subtitle && item.subtitle.toLowerCase().includes(lower)) return true;
      if (item.keywords && item.keywords.some((k) => k.toLowerCase().includes(lower))) return true;
      return false;
    });
  }, [items, query]);

  const activeItem = filteredItems[selectedIndex];

  // Extract actions for active item
  const currentActions: ActionDescriptor[] = useMemo(() => {
    if (activeItem?.actions) {
      return extractActionsFromElement(activeItem.actions);
    }
    if (props.actions) {
      return extractActionsFromElement(props.actions);
    }
    return [];
  }, [activeItem, props.actions]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowPalette((prev) => !prev);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, filteredItems.length - 1)));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const primary = currentActions[0];
        if (primary && primary.onAction) {
          void primary.onAction();
        }
      }
    },
    [filteredItems.length, currentActions],
  );

  return (
    <div
      className="asyar-raycast-list-container"
      onKeyDown={handleKeyDown}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-base, #111827)',
        color: 'var(--text-primary, #f9fafb)',
        fontFamily: 'Satoshi, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Search & Navigation Bar */}
      <div
        className="asyar-search-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          background: 'var(--bg-card, rgba(255, 255, 255, 0.03))',
        }}
      >
        <span style={{ fontSize: '14px', opacity: 0.6 }}>🔍</span>
        <input
          type="text"
          value={query}
          placeholder={props.searchBarPlaceholder ?? 'Search...'}
          onChange={(e) => handleQueryChange(e.target.value)}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary, #ffffff)',
            fontSize: '14px',
          }}
        />
        {props.isLoading && (
          <span
            style={{
              fontSize: '12px',
              color: 'var(--accent-primary, #6366f1)',
              animation: 'spin 1s linear infinite',
            }}
          >
            ⏳
          </span>
        )}
        {props.searchBarAccessory}
      </div>

      {/* Main Results List */}
      <div
        className="asyar-list-content"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        {filteredItems.length === 0
          ? (emptyView ?? (
              <ListEmptyView
                title="No results found"
                description="No matching items match your search."
              />
            ))
          : filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const isNewSection =
                item.sectionTitle &&
                (idx === 0 || filteredItems[idx - 1].sectionTitle !== item.sectionTitle);

              return (
                <React.Fragment key={item.id}>
                  {isNewSection && (
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--text-secondary, #94a3b8)',
                        padding: '8px 8px 4px 8px',
                        marginTop: idx > 0 ? '6px' : '0',
                      }}
                    >
                      {item.sectionTitle}
                    </div>
                  )}
                  <div
                    className={`asyar-list-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedIndex(idx)}
                    onDoubleClick={() => {
                      const primary = currentActions[0];
                      if (primary?.onAction) void primary.onAction();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: isSelected
                        ? 'var(--accent-primary, rgba(99, 102, 241, 0.15))'
                        : 'transparent',
                      border: isSelected
                        ? '1px solid var(--accent-border, rgba(99, 102, 241, 0.3))'
                        : '1px solid transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {item.icon && renderIconElement(item.icon, '16px')}
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: isSelected ? 600 : 400,
                          color: isSelected
                            ? 'var(--text-primary, #ffffff)'
                            : 'var(--text-secondary, #cbd5e1)',
                        }}
                      >
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-secondary, #94a3b8)',
                            opacity: 0.8,
                          }}
                        >
                          {item.subtitle}
                        </span>
                      )}
                    </div>

                    {item.accessories && item.accessories.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {item.accessories.map((acc, aIdx) => (
                          <span
                            key={aIdx}
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-secondary, #94a3b8)',
                              background: 'var(--bg-card, rgba(255, 255, 255, 0.05))',
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            {acc.icon && (
                              <span style={{ marginRight: '4px' }}>
                                {renderIconElement(acc.icon, '12px')}
                              </span>
                            )}
                            {acc.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
      </div>

      {/* Bottom Action Bar */}
      <div
        className="asyar-action-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '12px',
          padding: '8px 16px',
          borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          background: 'var(--bg-card, rgba(255, 255, 255, 0.02))',
          fontSize: '12px',
        }}
      >
        {currentActions[0] && (
          <button
            type="button"
            onClick={() => currentActions[0].onAction?.()}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary, #ffffff)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            <span
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '11px',
                background: 'var(--bg-card, rgba(255, 255, 255, 0.1))',
                padding: '2px 5px',
                borderRadius: '3px',
              }}
            >
              ↵
            </span>
            <span>{currentActions[0].title}</span>
          </button>
        )}

        {currentActions.length > 1 && (
          <button
            type="button"
            onClick={() => setShowPalette((prev) => !prev)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #94a3b8)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '11px',
                background: 'var(--bg-card, rgba(255, 255, 255, 0.1))',
                padding: '2px 5px',
                borderRadius: '3px',
              }}
            >
              ⌘K
            </span>
            <span>Actions</span>
          </button>
        )}
      </div>

      {/* ⌘K Action Palette Modal */}
      {showPalette && (
        <div
          className="asyar-action-palette-overlay"
          onClick={() => setShowPalette(false)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: '16px',
            backdropFilter: 'blur(4px)',
            zIndex: 100,
          }}
        >
          <div
            className="asyar-action-palette-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '420px',
              background: 'var(--bg-base, #1e293b)',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
              borderRadius: '12px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-secondary, #94a3b8)',
                padding: '6px 8px',
              }}
            >
              Actions for {activeItem?.title ?? 'Item'}
            </div>
            {currentActions.map((act) => (
              <button
                key={act.id}
                type="button"
                onClick={() => {
                  setShowPalette(false);
                  void act.onAction?.();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'var(--text-primary, #ffffff)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left',
                }}
              >
                <span>{act.title}</span>
                {act.shortcut && (
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary, #94a3b8)',
                      fontFamily: 'ui-monospace, monospace',
                    }}
                  >
                    {act.shortcut.modifiers.join('+')} {act.shortcut.key.toUpperCase()}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

List.Item = ListItem;
List.Section = ListSection;
List.EmptyView = ListEmptyView;
List.Dropdown = ListDropdown;
