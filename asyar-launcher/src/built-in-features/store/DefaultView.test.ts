// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DefaultView from './DefaultView.svelte';
import { storeViewState as store, type ApiExtension } from './state.svelte';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

describe('store/DefaultView.svelte', () => {
  const sampleExtension: ApiExtension = {
    id: 1,
    name: 'Awesome Tool',
    slug: 'awesome-tool',
    description: 'An awesome extension for testing',
    category: 'Developer Tools',
    status: 'INSTALLED',
    author: { id: 10, name: 'Alice Dev' },
    install_count: 1250,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-03-20T12:00:00Z',
    manifest: {
      type: 'extension',
      commands: [
        { id: 'run', name: 'Run Command' },
        { id: 'search', name: 'Search Command' },
      ],
    },
  };

  beforeEach(() => {
    store.allItems = [sampleExtension];
    store.isLoading = false;
    store.setSelectedItemByIndex(0);
  });

  it('renders metadata list with extension information', () => {
    const { container } = render(DefaultView);

    // Verify metadata list exists
    const metadataList = container.querySelector('.metadata-list');
    expect(metadataList).not.toBeNull();

    // Verify key metadata items within metadataList
    expect(metadataList?.textContent).toContain('Alice Dev');
    expect(metadataList?.textContent).toContain('Developer Tools');
    expect(metadataList?.textContent).toContain('1,250');
    expect(metadataList?.textContent).toContain('2');
    expect(metadataList?.textContent).toContain('Installed');
  });
});
