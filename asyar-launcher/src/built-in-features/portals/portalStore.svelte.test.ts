/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
