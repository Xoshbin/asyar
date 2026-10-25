/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DefaultView from './DefaultView.svelte';
import { portalStore } from './portalStore.svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

describe('Portals DefaultView', () => {
  beforeEach(() => {
    portalStore.portals = [];
  });

  it('renders metadata list for selected portal', () => {
    portalStore.portals = [
      {
        id: 'google',
        name: 'Search Google',
        url: 'https://google.com/search?q={query}',
        icon: '🌐',
        createdAt: Date.now(),
      },
    ];

    render(DefaultView);

    expect(screen.getByText('Information')).toBeTruthy();
    expect(screen.getByText('Command')).toBeTruthy();
    expect(screen.getAllByText('Placeholders').length).toBeGreaterThan(0);
    expect(screen.getByText('1 placeholder')).toBeTruthy();
    expect(screen.getByText('Created')).toBeTruthy();
  });
});
