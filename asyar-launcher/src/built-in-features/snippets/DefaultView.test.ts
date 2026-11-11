/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DefaultView from './DefaultView.svelte';
import { snippetStore } from './snippetStore.svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

describe('Snippets DefaultView', () => {
  beforeEach(() => {
    snippetStore.snippets = [];
  });

  it('renders a pin badge on pinned snippets', () => {
    snippetStore.snippets = [
      { id: '1', name: 'Pinned Snippet', expansion: 'exp1', createdAt: 1, pinned: true },
      { id: '2', name: 'Regular Snippet', expansion: 'exp2', createdAt: 2, pinned: false },
    ];

    render(DefaultView);

    expect(screen.getAllByText('Pinned Snippet').length).toBeGreaterThan(0);
    expect(screen.getByText('Regular Snippet')).toBeTruthy();

    const pinBadge = screen.getByTestId('snippet-pin-icon');
    expect(pinBadge).toBeTruthy();
    expect(pinBadge.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders metadata list for selected snippet', () => {
    snippetStore.snippets = [
      {
        id: '1',
        name: 'My Snippet',
        expansion: 'console.log("hello")',
        keyword: '!log',
        createdAt: Date.now(),
        isPrivate: true,
      },
    ];

    render(DefaultView);

    expect(screen.getByText('Keyword')).toBeTruthy();
    expect(screen.getAllByText('!log').length).toBeGreaterThan(0);
    expect(screen.getByText('Visibility')).toBeTruthy();
    expect(screen.getByText('Private (Local only)')).toBeTruthy();
    expect(screen.getByText('20 chars')).toBeTruthy();
  });

  it('registers Mod+Enter primary action without Save/Cancel buttons in create mode', async () => {
    const { snippetViewState } = await import('./snippetViewState.svelte');
    const { actionService } = await import('../../services/action/actionService.svelte');

    snippetViewState.startCreate();
    render(DefaultView);

    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();

    const saveAction = actionService.getAllActions().find((a) => a.id === 'snippets:save');
    expect(saveAction?.shortcut).toBe('Mod+Enter');
    expect(saveAction?.primary).toBe(true);
    snippetViewState.cancelEdit();
  });
});
