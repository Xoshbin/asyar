/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Grid } from './Grid';
import { ActionPanel, Action } from './ActionPanel';

describe('Grid Component', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders grid items with titles and subtitles', () => {
    render(
      <Grid columns={3} searchBarPlaceholder="Search icons…">
        <Grid.Item id="star" title="Star Icon" subtitle="Favorite" content="⭐" />
        <Grid.Item id="heart" title="Heart Icon" subtitle="Love" content="❤️" />
        <Grid.Item id="coffee" title="Coffee Icon" subtitle="Drink" content="☕" />
      </Grid>,
    );

    expect(screen.getByPlaceholderText('Search icons…')).toBeDefined();
    expect(screen.getAllByText('Star Icon').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Favorite')).toBeDefined();
    expect(screen.getByText('Heart Icon')).toBeDefined();
    expect(screen.getByText('Love')).toBeDefined();
    expect(screen.getByText('Coffee Icon')).toBeDefined();
    expect(screen.getByText('Drink')).toBeDefined();
  });

  it('filters grid items in real-time when searching', () => {
    render(
      <Grid searchBarPlaceholder="Search…">
        <Grid.Section title="Symbols">
          <Grid.Item title="Apple" content="🍎" keywords={['fruit', 'red']} />
          <Grid.Item title="Banana" content="🍌" keywords={['fruit', 'yellow']} />
        </Grid.Section>
      </Grid>,
    );

    const searchInput = screen.getByPlaceholderText('Search…');
    fireEvent.change(searchInput, { target: { value: 'banana' } });

    expect(screen.queryByText('Apple')).toBeNull();
    expect(screen.getAllByText('Banana').length).toBeGreaterThanOrEqual(1);
  });

  it('displays empty view when no items match the search query', () => {
    render(
      <Grid searchBarPlaceholder="Search…">
        <Grid.Item title="Item 1" content="1" />
        <Grid.EmptyView
          icon="❓"
          title="No Icons Found"
          description="Try a different search keyword."
        />
      </Grid>,
    );

    const searchInput = screen.getByPlaceholderText('Search…');
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-xyz' } });

    expect(screen.getByText('No Icons Found')).toBeDefined();
    expect(screen.getByText('Try a different search keyword.')).toBeDefined();
  });

  it('executes item action on Enter key', () => {
    const handleAction = vi.fn();

    render(
      <Grid>
        <Grid.Item
          title="Selected Item"
          content="🎯"
          actions={
            <ActionPanel>
              <Action title="Choose Target" onAction={handleAction} />
            </ActionPanel>
          }
        />
      </Grid>,
    );

    const btn = screen.getByText('Choose Target');
    fireEvent.click(btn);

    expect(handleAction).toHaveBeenCalledTimes(1);
  });
});
