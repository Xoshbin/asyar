/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { List } from './List';
import { ActionPanel, Action } from './ActionPanel';
import { Clipboard } from '../clipboard';
import { open } from '../navigation';
import { setRaycastContext } from '../context';

vi.mock('../clipboard', () => ({
  Clipboard: {
    copy: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../navigation', () => ({
  open: vi.fn().mockResolvedValue(undefined),
  closeMainWindow: vi.fn().mockResolvedValue(undefined),
  popToRoot: vi.fn().mockResolvedValue(undefined),
}));

describe('React UI Primitives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRaycastContext({
      getService: vi.fn().mockReturnValue({}),
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a List with search input and items', () => {
    render(
      <List searchBarPlaceholder="Search items...">
        <List.Item id="item-1" title="First Item" subtitle="Subtitle 1" />
        <List.Item id="item-2" title="Second Item" subtitle="Subtitle 2" />
      </List>,
    );

    expect(screen.getByPlaceholderText('Search items...')).toBeDefined();
    expect(screen.getByText('First Item')).toBeDefined();
    expect(screen.getByText('Second Item')).toBeDefined();
  });

  it('filters items when search input changes', () => {
    render(
      <List searchBarPlaceholder="Filter...">
        <List.Item id="item-apple" title="Apple" keywords={['fruit']} />
        <List.Item id="item-banana" title="Banana" keywords={['yellow']} />
      </List>,
    );

    const searchInput = screen.getByPlaceholderText('Filter...');
    fireEvent.change(searchInput, { target: { value: 'fruit' } });

    expect(screen.getByText('Apple')).toBeDefined();
    expect(screen.queryByText('Banana')).toBeNull();
  });

  it('renders List.Section headers', () => {
    render(
      <List>
        <List.Section title="Favorites">
          <List.Item id="fav-1" title="Starred Document" />
        </List.Section>
        <List.Section title="Recents">
          <List.Item id="rec-1" title="Recent File" />
        </List.Section>
      </List>,
    );

    expect(screen.getByText('Favorites')).toBeDefined();
    expect(screen.getByText('Starred Document')).toBeDefined();
    expect(screen.getByText('Recents')).toBeDefined();
    expect(screen.getByText('Recent File')).toBeDefined();
  });

  it('renders List.EmptyView when search finds no results', () => {
    render(
      <List searchBarPlaceholder="Search...">
        <List.EmptyView title="No results found" description="Try a different query" />
        <List.Item id="item-1" title="Unique Item" />
      </List>,
    );

    const searchInput = screen.getByPlaceholderText('Search...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    expect(screen.getByText('No results found')).toBeDefined();
    expect(screen.getByText('Try a different query')).toBeDefined();
  });

  it('renders ActionPanel with CopyToClipboard action and executes copy', async () => {
    render(
      <List>
        <List.Item
          id="item-1"
          title="Item with actions"
          actions={
            <ActionPanel>
              <Action.CopyToClipboard content="Copied text value" title="Copy Text" />
            </ActionPanel>
          }
        />
      </List>,
    );

    // Primary action shown in action bar
    const copyButton = screen.getByText(/Copy Text/i);
    expect(copyButton).toBeDefined();

    fireEvent.click(copyButton);
    expect(Clipboard.copy).toHaveBeenCalledWith('Copied text value');
  });

  it('executes Action.OpenInBrowser', async () => {
    render(
      <List>
        <List.Item
          id="item-1"
          title="Item with browser action"
          actions={
            <ActionPanel>
              <Action.OpenInBrowser url="https://asyar.org" title="Open Webpage" />
            </ActionPanel>
          }
        />
      </List>,
    );

    const openButton = screen.getByText(/Open Webpage/i);
    fireEvent.click(openButton);

    expect(open).toHaveBeenCalledWith('https://asyar.org');
  });

  it('renders complex icon objects with source and tintColor without [object Object]', () => {
    const { container } = render(
      <List>
        <List.Item
          id="item-code"
          title="Code Snippet"
          icon={{ source: '💻', tintColor: '#ec4899' }}
          accessories={[{ text: 'Tagged', icon: { source: '🏷️' } }]}
        />
      </List>,
    );

    expect(container.textContent).not.toContain('[object Object]');
    expect(screen.getByText('Code Snippet')).toBeDefined();
    expect(screen.getByText('💻')).toBeDefined();
    expect(screen.getByText('🏷️')).toBeDefined();
  });
});
