// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PrimaryActionDisplay from './PrimaryActionDisplay.svelte';
import type { SearchResult } from '../../services/search/interfaces/SearchResult';

const item = (over: Partial<SearchResult>): SearchResult =>
  ({ objectId: 'x', name: 'X', type: 'command', score: 1, ...over }) as SearchResult;

describe('PrimaryActionDisplay', () => {
  it('defaults commands to Run and applications to Open', () => {
    const { unmount } = render(PrimaryActionDisplay, { selectedItem: item({}) });
    expect(screen.getByText('Run')).toBeTruthy();
    unmount();

    render(PrimaryActionDisplay, { selectedItem: item({ type: 'application' }) });
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('prefers the label the row supplies', () => {
    render(PrimaryActionDisplay, { selectedItem: item({ primaryActionLabel: 'Copy' }) });
    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.queryByText('Run')).toBeNull();
  });

  it('lets an open extension view override the row label', () => {
    render(PrimaryActionDisplay, {
      selectedItem: item({ primaryActionLabel: 'Copy' }),
      activeViewLabel: 'Save',
    });
    expect(screen.getByText('Save')).toBeTruthy();
  });
});
