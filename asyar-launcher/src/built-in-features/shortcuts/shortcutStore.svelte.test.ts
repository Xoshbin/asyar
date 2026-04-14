/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/envService', () => ({
  envService: { isTauri: false },
}));

vi.mock('../../lib/ipc/commands', () => ({
  shortcutUpsert: vi.fn(),
  shortcutGetAll: vi.fn(async () => []),
  shortcutRemove: vi.fn(),
}));

import { shortcutStore } from './shortcutStore.svelte';
import { envService } from '../../services/envService';
import { shortcutGetAll } from '../../lib/ipc/commands';

const makeShortcut = (id: string) => ({
  id,
  objectId: `obj_${id}`,
  itemName: `Item ${id}`,
  itemType: 'command' as const,
  shortcut: 'Shift+A',
  createdAt: 0,
});

describe('shortcutStore', () => {
  beforeEach(() => {
    shortcutStore.shortcuts = [];
    vi.clearAllMocks();
  });

  it('add() inserts a shortcut', () => {
    shortcutStore.add(makeShortcut('1'));
    expect(shortcutStore.shortcuts).toHaveLength(1);
    expect(shortcutStore.shortcuts[0].objectId).toBe('obj_1');
  });

  it('add() replaces shortcut with same objectId', () => {
    shortcutStore.add(makeShortcut('1'));
    shortcutStore.add({ ...makeShortcut('1'), shortcut: 'Ctrl+B' });
    expect(shortcutStore.shortcuts).toHaveLength(1);
    expect(shortcutStore.shortcuts[0].shortcut).toBe('Ctrl+B');
  });

  it('remove() deletes by objectId', () => {
    shortcutStore.add(makeShortcut('1'));
    shortcutStore.add(makeShortcut('2'));
    shortcutStore.remove('obj_1');
    expect(shortcutStore.shortcuts).toHaveLength(1);
    expect(shortcutStore.shortcuts[0].objectId).toBe('obj_2');
  });

  it('getAll() returns all shortcuts', () => {
    shortcutStore.add(makeShortcut('1'));
    shortcutStore.add(makeShortcut('2'));
    expect(shortcutStore.getAll()).toHaveLength(2);
  });

  describe('reload()', () => {
    beforeEach(() => {
      (envService as any).isTauri = true;
    });

    afterEach(() => {
      (envService as any).isTauri = false;
    });

    it('re-fetches from DB and replaces stale in-memory state', async () => {
      shortcutStore.shortcuts = [makeShortcut('stale')] as any;
      vi.mocked(shortcutGetAll).mockResolvedValueOnce([makeShortcut('fresh')] as any);

      await shortcutStore.reload();

      expect(shortcutGetAll).toHaveBeenCalled();
      expect(shortcutStore.shortcuts).toHaveLength(1);
      expect(shortcutStore.shortcuts[0].id).toBe('fresh');
    });

    it('allows init() to run again after the store was already initialized', async () => {
      vi.mocked(shortcutGetAll).mockResolvedValue([]);
      await shortcutStore.init();

      const callsBefore = vi.mocked(shortcutGetAll).mock.calls.length;
      await shortcutStore.reload();
      expect(vi.mocked(shortcutGetAll).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
