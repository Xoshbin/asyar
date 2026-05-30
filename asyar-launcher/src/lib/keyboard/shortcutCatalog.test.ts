import { describe, it, expect } from 'vitest';
import { LAUNCHER_SHORTCUTS, type ShortcutEntry } from './shortcutCatalog';

describe('LAUNCHER_SHORTCUTS', () => {
  it('is a non-empty list', () => {
    expect(LAUNCHER_SHORTCUTS.length).toBeGreaterThan(0);
  });

  it('every entry has display keys, a label, and a valid scope', () => {
    const scopes = new Set(['global', 'view', 'context']);
    for (const entry of LAUNCHER_SHORTCUTS as readonly ShortcutEntry[]) {
      expect(Array.isArray(entry.keys)).toBe(true);
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(scopes.has(entry.scope)).toBe(true);
    }
  });

  it('documents the core launcher shortcuts', () => {
    const labels = LAUNCHER_SHORTCUTS.map((s) => s.label.toLowerCase()).join(' | ');
    expect(labels).toContain('action panel');
    expect(labels).toContain('settings');
  });
});
