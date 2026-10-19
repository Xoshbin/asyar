import { describe, it, expect } from 'vitest';
import { actionShortcutEntries } from './actionShortcutCatalog';

describe('actionShortcutEntries', () => {
  const actions = [
    { label: 'New Note', shortcut: 'Mod+N' },
    { label: 'Copy Path', shortcut: 'Mod+Shift+C' },
    { label: 'No shortcut' },
    { label: 'New Note', shortcut: 'Mod+N' },
  ];

  it('lists only actions that declare a shortcut, once each', () => {
    expect(actionShortcutEntries(actions, 'macos').map((e) => e.label)).toEqual([
      'New Note',
      'Copy Path',
    ]);
  });

  it('renders keys for the platform', () => {
    expect(actionShortcutEntries(actions, 'macos')[1].keys).toEqual(['⌘', '⇧', 'C']);
    expect(actionShortcutEntries(actions, 'windows')[1].keys).toEqual(['Ctrl', 'Shift', 'C']);
  });
});
