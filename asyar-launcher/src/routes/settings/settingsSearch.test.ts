import { describe, it, expect } from 'vitest';
import { searchSettings, SETTINGS_ROW_CATALOG } from './settingsSearch';
import type { ExtensionItem } from './settingsHandlers.svelte';

const exts = [
  {
    id: 'built-in-notes',
    title: 'Notes',
    subtitle: 'Quick notes',
    isBuiltIn: true,
    commands: [{ id: 'new', name: 'Create Note' }],
  },
  { id: 'org.x.store', title: 'Weather', isBuiltIn: false, commands: [] },
] as unknown as ExtensionItem[];

describe('searchSettings', () => {
  it('returns nothing for a blank query', () => {
    expect(searchSettings('  ', exts, false)).toEqual([]);
  });

  it('finds a settings row by label and by keyword, pointing at its tab', () => {
    expect(searchSettings('shell', exts, false)[0].target).toEqual({ tab: 'privacy' });
    expect(searchSettings('cloud sync', exts, false).every((r) => r.target.tab === 'account')).toBe(
      true,
    );
  });

  it('finds built-in features and commands under built-in-features', () => {
    const hits = searchSettings('note', exts, false);
    expect(hits.find((h) => h.id === 'ext:built-in-notes')?.target).toEqual({
      tab: 'built-in-features',
      extensionId: 'built-in-notes',
    });
    expect(hits.find((h) => h.title === 'Create Note')?.target.extensionId).toBe('built-in-notes');
  });

  it('finds installed extensions under extensions', () => {
    expect(searchSettings('weath', exts, false)[0].target).toEqual({
      tab: 'extensions',
      extensionId: 'org.x.store',
    });
  });

  it('hides Developer rows until Developer Mode is on', () => {
    expect(searchSettings('verbose', exts, false)).toEqual([]);
    expect(searchSettings('verbose', exts, true)[0].target.tab).toBe('developer');
  });

  it('catalog has no duplicate labels per tab', () => {
    const keys = SETTINGS_ROW_CATALOG.map((e) => e.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
