import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ItemShortcut } from './shortcutStore.svelte';

let rows: ItemShortcut[] = [];
const remove = vi.fn((id: string) => {
  rows = rows.filter((r) => r.objectId !== id);
});

vi.mock('./shortcutStore.svelte', () => ({
  shortcutStore: { getAll: () => [...rows], remove: (id: string) => remove(id) },
}));

import { healDuplicateChords } from './shortcutHeal';

const sc = (objectId: string, shortcut: string, createdAt: number): ItemShortcut => ({
  id: objectId,
  objectId,
  itemName: objectId,
  itemType: 'command',
  shortcut,
  createdAt,
});

describe('healDuplicateChords', () => {
  beforeEach(() => {
    rows = [];
    remove.mockClear();
  });

  it('keeps the live agent row even when a dead one is newer, and removes the rest', () => {
    rows = [
      sc('cmd_agents_dyn_live', 'Super+Shift+L', 1000),
      sc('cmd_agents_dyn_dead1', 'Super+Shift+L', 9000),
      sc('cmd_agents_dyn_dead2', 'Shift+Super+L', 8000),
    ];
    const removed = healDuplicateChords(new Set(['live']));
    expect(removed).toBe(2);
    expect(rows.map((r) => r.objectId)).toEqual(['cmd_agents_dyn_live']);
  });

  it('spares unique-chord rows for apps and commands that are not loaded yet', () => {
    rows = [
      sc('app_Safari__Applications_Safari.app', 'Super+1', 1),
      sc('cmd_org.asyar.browser_command-bar', 'Super+2', 1),
      sc('cmd_agents_dyn_other-device', 'Super+3', 1),
    ];
    expect(healDuplicateChords(new Set())).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not treat a non-agent row as dead when it collides with a dead agent row', () => {
    rows = [
      sc('app_Safari__Applications_Safari.app', 'Super+L', 1),
      sc('cmd_agents_dyn_dead', 'Super+L', 9000),
    ];
    healDuplicateChords(new Set());
    expect(rows.map((r) => r.objectId)).toEqual(['app_Safari__Applications_Safari.app']);
  });
});
