import { describe, it, expect } from 'vitest';
import { getCommandBarKeyAction } from './settingsCommandBar.logic';

function key(overrides: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean }>) {
  return { key: '', metaKey: false, ctrlKey: false, ...overrides };
}

describe('getCommandBarKeyAction', () => {
  it('focuses on Cmd+F', () => {
    expect(getCommandBarKeyAction(key({ key: 'f', metaKey: true }), false, false)).toBe(
      'focus-search',
    );
  });

  it('focuses on Ctrl+F', () => {
    expect(getCommandBarKeyAction(key({ key: 'F', ctrlKey: true }), false, false)).toBe(
      'focus-search',
    );
  });

  it('clears on Escape when focused and non-empty', () => {
    expect(getCommandBarKeyAction(key({ key: 'Escape' }), true, true)).toBe('clear-search');
  });

  it('does nothing on Escape when not focused', () => {
    expect(getCommandBarKeyAction(key({ key: 'Escape' }), false, true)).toBe('none');
  });

  it('does nothing on Escape when focused but already empty', () => {
    expect(getCommandBarKeyAction(key({ key: 'Escape' }), true, false)).toBe('none');
  });

  it('does nothing for an unrelated key', () => {
    expect(getCommandBarKeyAction(key({ key: 'a' }), true, true)).toBe('none');
  });
});
