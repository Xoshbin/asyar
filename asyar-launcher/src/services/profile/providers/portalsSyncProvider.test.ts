import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortalsSyncProvider } from './portalsSyncProvider';
import type { SyncProviderData } from '../types';

const mockPortals = [
  { id: 'p1', name: 'Google', url: 'https://google.com/search?q={query}', icon: '🌐', createdAt: 1000 },
  { id: 'p2', name: 'GitHub', url: 'https://github.com/search?q={query}', icon: '🐙', createdAt: 2000 },
];

vi.mock('../../../built-in-features/portals/portalStore.svelte', () => ({
  portalStore: {
    getAll: vi.fn(() => [...mockPortals]),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

describe('PortalsSyncProvider', () => {
  let provider: PortalsSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new PortalsSyncProvider();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('portals');
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('merge');
    expect(provider.sensitiveFields).toEqual([]);
  });

  describe('exportFull', () => {
    it('exports all portals', async () => {
      const result = await provider.exportFull();
      expect(result.providerId).toBe('portals');
      expect(result.version).toBe(1);
      expect(result.data).toEqual(mockPortals);
      expect(result.binaryAssets).toBeUndefined();
    });
  });

  describe('exportForSync', () => {
    it('returns same data as exportFull', async () => {
      const full = await provider.exportFull();
      const sync = await provider.exportForSync();
      expect(sync.data).toEqual(full.data);
    });
  });

  describe('preview', () => {
    it('calculates correct preview stats', async () => {
      const incoming: SyncProviderData = {
        providerId: 'portals',
        version: 1,
        exportedAt: Date.now(),
        data: [
          { id: 'p1', name: 'Google', url: 'https://google.com/search?q={query}', icon: '🌐', createdAt: 3000 }, // conflict
          { id: 'p3', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}', icon: '🦆', createdAt: 3000 }, // new
        ],
      };

      const preview = await provider.preview(incoming);
      expect(preview.localCount).toBe(2);
      expect(preview.incomingCount).toBe(2);
      expect(preview.conflicts).toBe(1); // p1 exists in both
      expect(preview.newItems).toBe(1);  // p3 is new
      expect(preview.removedItems).toBe(1); // p2 only in local
    });
  });

  describe('applyImport', () => {
    it('replace — removes all existing and adds incoming', async () => {
      const { portalStore } = await import('../../../built-in-features/portals/portalStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'portals',
        version: 1,
        exportedAt: Date.now(),
        data: [
          { id: 'p10', name: 'Bing', url: 'https://bing.com/search?q={query}', icon: '🔎', createdAt: 5000 },
        ],
      };

      const result = await provider.applyImport(incoming, 'replace');
      expect(portalStore.remove).toHaveBeenCalledTimes(2); // removes existing 2
      expect(portalStore.add).toHaveBeenCalledTimes(1);    // adds 1 incoming
      expect(result.success).toBe(true);
      expect(result.itemsAdded).toBe(1);
      expect(result.itemsRemoved).toBe(2);
    });

    it('merge — adds new, updates newer, skips older', async () => {
      const { portalStore } = await import('../../../built-in-features/portals/portalStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'portals',
        version: 1,
        exportedAt: Date.now(),
        data: [
          { id: 'p1', name: 'Google Updated', url: 'https://google.com/search?q={query}', icon: '🌐', createdAt: 9999 }, // newer → update
          { id: 'p2', name: 'GitHub', url: 'https://github.com/search?q={query}', icon: '🐙', createdAt: 500 },          // older → skip
          { id: 'p3', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}', icon: '🦆', createdAt: 5000 },        // new → add
        ],
      };

      const result = await provider.applyImport(incoming, 'merge');
      expect(portalStore.add).toHaveBeenCalledTimes(1);    // p3
      expect(portalStore.update).toHaveBeenCalledTimes(1); // p1 (newer)
      expect(result.itemsAdded).toBe(1);
      expect(result.itemsUpdated).toBe(1);
    });

    it('skip — does nothing', async () => {
      const { portalStore } = await import('../../../built-in-features/portals/portalStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'portals',
        version: 1,
        exportedAt: Date.now(),
        data: [{ id: 'p99', name: 'Test', url: 'https://test.com/?q={query}', icon: '🧪', createdAt: 1 }],
      };

      const result = await provider.applyImport(incoming, 'skip');
      expect(portalStore.add).not.toHaveBeenCalled();
      expect(portalStore.update).not.toHaveBeenCalled();
      expect(portalStore.remove).not.toHaveBeenCalled();
      expect(result.itemsAdded).toBe(0);
      expect(result.itemsUpdated).toBe(0);
    });
  });

  describe('getLocalSummary', () => {
    it('returns correct count and label', async () => {
      const summary = await provider.getLocalSummary();
      expect(summary.itemCount).toBe(2);
      expect(summary.label).toBe('2 portals');
    });
  });
});
