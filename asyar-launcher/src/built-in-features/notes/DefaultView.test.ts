/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DefaultView from './DefaultView.svelte';
import { noteStore } from './noteStore.svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

describe('Notes DefaultView', () => {
  beforeEach(() => {
    noteStore.notes = [];
  });

  it('renders a pin badge on pinned notes', () => {
    noteStore.notes = [
      { id: 'n1', title: 'Pinned Note', body: 'body1', createdAt: 1, updatedAt: 1, pinned: true },
      { id: 'n2', title: 'Regular Note', body: 'body2', createdAt: 2, updatedAt: 2, pinned: false },
    ];

    render(DefaultView);

    expect(screen.getByText('Pinned Note')).toBeTruthy();
    expect(screen.getByText('Regular Note')).toBeTruthy();

    const pinBadge = screen.getByTestId('note-pin-icon');
    expect(pinBadge).toBeTruthy();
    expect(pinBadge.getAttribute('aria-label')).toBeTruthy();
  });
});
