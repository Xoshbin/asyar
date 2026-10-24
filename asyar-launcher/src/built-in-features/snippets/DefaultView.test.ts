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
});
