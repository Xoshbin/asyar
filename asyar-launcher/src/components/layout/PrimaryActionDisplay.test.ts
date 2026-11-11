// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
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

  it('renders custom shortcut keycaps (e.g. Mod+Enter) and runs onclick when enabled', async () => {
    const onclick = vi.fn();
    render(PrimaryActionDisplay, {
      activeViewLabel: 'Save Snippet',
      activeViewShortcut: 'Mod+Enter',
      onclick,
    });
    expect(screen.getByText('Save Snippet')).toBeTruthy();
    expect(screen.getByText('↵')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Save Snippet/i }));
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('disables the primary button when disabled=true', async () => {
    const onclick = vi.fn();
    render(PrimaryActionDisplay, {
      activeViewLabel: 'Continue',
      activeViewShortcut: 'Mod+Enter',
      disabled: true,
      onclick,
    });
    const btn = screen.getByRole('button', { name: /Continue/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await fireEvent.click(btn);
    expect(onclick).not.toHaveBeenCalled();
  });
});
