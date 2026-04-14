/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortalsSyncProvider } from '../../services/profile/providers/portalsSyncProvider';
import type { SyncProviderData } from '../../services/profile/types';

const mockLoad = vi.hoisted(() => vi.fn(async () => []));
const mockLoadSync = vi.hoisted(() => vi.fn(() => []));
const mockSave = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../lib/persistence/extensionStore', () => ({
  createPersistence: vi.fn(() => ({
    load: mockLoad,
    loadSync: mockLoadSync,
    save: mockSave,
  })),
}));

import { portalStore, type Portal } from './portalStore.svelte';

const makePortal = (id: string): Portal => ({
  id,
  name: `Portal ${id}`,
  url: `https://example.com/${id}`,
  icon: '🌐',
  createdAt: 0,
});

describe('portalStore', () => {
  beforeEach(() => {
    portalStore.portals = [];
    vi.clearAllMocks();
  });

  it('add() inserts a portal', () => {
    portalStore.add(makePortal('1'));
    expect(portalStore.portals).toHaveLength(1);
    expect(portalStore.portals[0].id).toBe('1');
  });

  it('update() merges changes', () => {
    portalStore.add(makePortal('1'));
    portalStore.update('1', { name: 'Updated' });
    expect(portalStore.portals[0].name).toBe('Updated');
    expect(portalStore.portals[0].url).toBe('https://example.com/1');
  });

  it('remove() deletes by id', () => {
    portalStore.add(makePortal('1'));
    portalStore.add(makePortal('2'));
    portalStore.remove('1');
    expect(portalStore.portals).toHaveLength(1);
    expect(portalStore.portals[0].id).toBe('2');
  });

  it('getAll() returns all portals', () => {
    portalStore.add(makePortal('1'));
    portalStore.add(makePortal('2'));
    expect(portalStore.getAll()).toHaveLength(2);
  });

  describe('reload()', () => {
    it('re-fetches from persistence and replaces stale in-memory state', async () => {
      portalStore.portals = [makePortal('stale')];
      mockLoad.mockResolvedValueOnce([makePortal('fresh')]);

      await portalStore.reload();

      expect(mockLoad).toHaveBeenCalled();
      expect(portalStore.portals).toHaveLength(1);
      expect(portalStore.portals[0].id).toBe('fresh');
    });

    it('allows init() to run again after the store was already initialized', async () => {
      mockLoad.mockResolvedValue([]);
      await portalStore.init();

      const callsBefore = mockLoad.mock.calls.length;
      await portalStore.reload();
      expect(mockLoad.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

describe('seedDefaults stability', () => {
  beforeEach(() => {
    portalStore.portals = [];
    vi.clearAllMocks();
  });

  it('returns portals with the same stable IDs regardless of how many times seedDefaults is called', async () => {
    mockLoad.mockResolvedValue([]); // always empty → triggers seedDefaults each reload

    await portalStore.reload();
    const firstIds = portalStore.portals.map(p => p.id).sort();

    await portalStore.reload();
    const secondIds = portalStore.portals.map(p => p.id).sort();

    expect(firstIds).toHaveLength(3);
    expect(firstIds).toEqual(secondIds);
  });
});

describe('init() deduplication', () => {
  beforeEach(() => {
    portalStore.portals = [];
    vi.clearAllMocks();
  });

  it('deduplicates portals with the same id on load and persists the cleaned list', async () => {
    const dup = makePortal('dup-id');
    const other = makePortal('other-id');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLoad.mockResolvedValueOnce([dup, { ...dup }, other] as any); // 2 copies of dup-id

    await portalStore.reload();

    expect(portalStore.portals).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedData = (mockSave.mock.calls as any).at(-1)?.[0];
    expect(savedData).toHaveLength(2);
  });
});

describe('sync duplicate healing', () => {
  beforeEach(() => {
    portalStore.portals = [];
    vi.clearAllMocks();
  });

  it('merging a backup with 9 portals (3 sets of 3 stable IDs) results in exactly 3 portals', async () => {
    // Initialize store with empty persistence → triggers seedDefaults
    mockLoad.mockResolvedValueOnce([]);
    await portalStore.reload();
    // Before fix: portals have random UUIDs → none match the stable IDs in snapshot
    // After fix: portals have stable IDs → merge correctly skips/updates, never adds

    const stablePortals = [
      { id: 'default-search-google',    name: 'Search Google',    url: 'https://google.com/search?q={query}',   icon: '🌐', createdAt: 1000 },
      { id: 'default-search-github',    name: 'Search GitHub',    url: 'https://github.com/search?q={query}',   icon: '🐙', createdAt: 1000 },
      { id: 'default-search-wikipedia', name: 'Search Wikipedia', url: 'https://en.wikipedia.org/wiki/{query}', icon: '📖', createdAt: 1000 },
    ];

    // 9-portal snapshot: 3 copies of each of the 3 stable IDs
    const snapshot: SyncProviderData = {
      providerId: 'portals',
      version: 1,
      exportedAt: Date.now(),
      data: [
        ...stablePortals.map(p => ({ ...p, createdAt: 500  })),  // set 1 – older
        ...stablePortals.map(p => ({ ...p, createdAt: 800  })),  // set 2 – still older
        ...stablePortals.map(p => ({ ...p, createdAt: 1200 })),  // set 3 – newer
      ],
    };

    const provider = new PortalsSyncProvider();
    await provider.applyImport(snapshot, 'merge');

    expect(portalStore.portals).toHaveLength(3);
  });
});
