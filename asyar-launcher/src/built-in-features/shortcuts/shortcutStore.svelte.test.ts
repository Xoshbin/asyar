/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  shortcutUpsert: vi.fn().mockResolvedValue(undefined),
  shortcutGetAll: vi.fn(async () => []),
  shortcutRemove: vi.fn().mockResolvedValue(undefined),
}));

const mockListen = vi.hoisted(() => {
  const callbacks = new Map<string, Array<(payload: unknown) => void>>();
  const listen = vi.fn(async (event: string, cb: (payload: unknown) => void) => {
    if (!callbacks.has(event)) callbacks.set(event, []);
    callbacks.get(event)!.push(cb);
    return () => {};
  });
  const fire = (event: string, payload: unknown = {}) => {
    const arr = callbacks.get(event);
    if (!arr) return;
    for (const cb of arr) cb(payload);
  };
  return { listen, fire };
});
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen.listen }));

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

  describe('cross-webview sync via shortcuts:changed event', () => {
    it('reloads from SQLite when Rust fires shortcuts:changed', async () => {
      // Symptom this pins: onboarding's Hidden AI commands step writes a
      // shortcut from a SEPARATE webview. Without this listener, the main
      // launcher's in-memory store stays empty and handleFiredShortcut
      // logs "Received shortcut for unknown objectId" when the user hits
      // the hotkey — even though Rust dispatched correctly.
      vi.mocked(shortcutGetAll).mockResolvedValueOnce([] as any);
      await shortcutStore.init();
      expect(shortcutStore.shortcuts).toHaveLength(0);

      // Simulate the cross-webview write: SQLite now has a new entry.
      vi.mocked(shortcutGetAll).mockResolvedValueOnce([
        makeShortcut('grammar-fix', {
          objectId: 'cmd_agents_dyn_abc',
          itemName: 'Grammar Fix',
          shortcut: 'Cmd+Shift+L',
        }),
      ] as any);

      mockListen.fire('shortcuts:changed');
      // Let the async reload() complete.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(shortcutStore.shortcuts).toHaveLength(1);
      expect(shortcutStore.shortcuts[0].objectId).toBe('cmd_agents_dyn_abc');
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
