import { describe, it, expect } from 'vitest';
import { findChordLosers, outranks } from './shortcutDedupe';
import type { ItemShortcut } from './shortcutStore.svelte';

function sc(objectId: string, shortcut: string, createdAt: number): ItemShortcut {
  return { id: objectId, objectId, itemName: objectId, itemType: 'command', shortcut, createdAt };
}

describe('outranks', () => {
  it('prefers the newer createdAt', () => {
    expect(outranks(sc('a', 'Super+L', 2), sc('b', 'Super+L', 1))).toBe(true);
    expect(outranks(sc('a', 'Super+L', 1), sc('b', 'Super+L', 2))).toBe(false);
  });

  it('breaks createdAt ties on the larger objectId so every device agrees', () => {
    expect(outranks(sc('b', 'Super+L', 1), sc('a', 'Super+L', 1))).toBe(true);
    expect(outranks(sc('a', 'Super+L', 1), sc('b', 'Super+L', 1))).toBe(false);
  });

  it('prefers a live row over a newer dead one', () => {
    const live = (s: ItemShortcut) => s.objectId === 'old';
    expect(outranks(sc('old', 'Super+L', 1), sc('new', 'Super+L', 9), live)).toBe(true);
  });
});

describe('findChordLosers', () => {
  it('returns nothing when every chord is unique', () => {
    expect(findChordLosers([sc('a', 'Super+A', 1), sc('b', 'Super+B', 2)])).toEqual([]);
  });

  it('keeps one winner per chord and returns the rest', () => {
    const all = [sc('a', 'Super+L', 1), sc('b', 'Super+L', 3), sc('c', 'Super+L', 2)];
    expect(
      findChordLosers(all)
        .map((s) => s.objectId)
        .sort(),
    ).toEqual(['a', 'c']);
  });

  it('treats differently-ordered modifiers as the same chord', () => {
    const all = [sc('a', 'Super+Shift+L', 1), sc('b', 'Shift+Super+L', 2)];
    expect(findChordLosers(all).map((s) => s.objectId)).toEqual(['a']);
  });

  it('never removes a row whose chord is unique, even if it looks orphaned', () => {
    const all = [sc('cmd_agents_dyn_dead', 'Super+K', 1), sc('app_x', 'Super+X', 1)];
    expect(findChordLosers(all, () => false)).toEqual([]);
  });
});
