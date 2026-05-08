/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  shortcutUpsert: vi.fn().mockResolvedValue(undefined),
  shortcutGetAll: vi.fn(async () => []),
  shortcutRemove: vi.fn().mockResolvedValue(undefined),
}));

import { shortcutStore, groupShortcutsBySection, type ItemShortcut } from './shortcutStore.svelte';
import { shortcutGetAll } from '../../lib/ipc/commands';

const makeShortcut = (id: string, overrides: Partial<ItemShortcut> = {}): ItemShortcut => ({
  id,
  objectId: `obj_${id}`,
  itemName: `Item ${id}`,
  itemType: 'command',
  shortcut: 'Shift+A',
  createdAt: 0,
  ...overrides,
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

describe('groupShortcutsBySection', () => {
  it('returns empty buckets for an empty array', () => {
    expect(groupShortcutsBySection([])).toEqual({ applications: [], commands: [] });
  });

  it('groups all-application input into the applications bucket', () => {
    const items = [
      makeShortcut('1', { itemType: 'application', itemName: 'Safari' }),
      makeShortcut('2', { itemType: 'application', itemName: 'Notes' }),
    ];
    const result = groupShortcutsBySection(items);
    expect(result.applications.map(s => s.itemName)).toEqual(['Safari', 'Notes']);
    expect(result.commands).toEqual([]);
  });

  it('groups all-command input into the commands bucket', () => {
    const items = [
      makeShortcut('1', { itemType: 'command', itemName: 'Toggle Theme' }),
    ];
    const result = groupShortcutsBySection(items);
    expect(result.commands.map(s => s.itemName)).toEqual(['Toggle Theme']);
    expect(result.applications).toEqual([]);
  });

  it('preserves input order within each bucket', () => {
    const items = [
      makeShortcut('1', { itemType: 'application', itemName: 'A'  }),
      makeShortcut('2', { itemType: 'command',     itemName: 'C1' }),
      makeShortcut('3', { itemType: 'application', itemName: 'B'  }),
      makeShortcut('4', { itemType: 'command',     itemName: 'C2' }),
    ];
    const result = groupShortcutsBySection(items);
    expect(result.applications.map(s => s.itemName)).toEqual(['A', 'B']);
    expect(result.commands.map(s => s.itemName)).toEqual(['C1', 'C2']);
  });

  it('buckets an unknown itemType into commands (catch-all)', () => {
    const items = [makeShortcut('1', { itemType: 'other' as ItemShortcut['itemType'], itemName: 'X' })];
    const result = groupShortcutsBySection(items);
    expect(result.commands.map(s => s.itemName)).toEqual(['X']);
    expect(result.applications).toEqual([]);
  });
});
