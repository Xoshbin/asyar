// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  validateActionShortcut,
  assertActionShortcut,
  eventToActionChord,
  resolveActionChord,
  RESERVED_ACTION_SHORTCUTS,
  type ActionShortcutPlatform,
} from './actionShortcut';

const ev = (init: KeyboardEventInit & { code?: string }) => new KeyboardEvent('keydown', init);

describe('validateActionShortcut', () => {
  it.each([
    'Mod+N',
    'Mod+Shift+C',
    'Mod+Alt+C',
    'Mod+Alt+Shift+F',
    'Mod+Shift+,',
    'Mod+Enter',
    'F5',
  ])('accepts canonical %s', (s) => {
    expect(validateActionShortcut(s)).toBeNull();
  });

  it.each([
    ['⌘N', 'glyph'],
    ['Cmd+N', 'alias'],
    ['Ctrl+N', 'alias'],
    ['Control+N', 'literal control'],
    ['Super+N', 'super'],
    ['Meta+N', 'meta'],
    ['mod+n', 'lowercase'],
    ['Mod+n', 'lowercase key'],
    ['Shift+Mod+N', 'non-canonical order'],
    ['Alt+Mod+N', 'non-canonical order'],
    ['', 'empty'],
    ['Mod+', 'missing key'],
    ['Mod', 'modifier only'],
    ['Mod+Mod+N', 'duplicate modifier'],
    ['N', 'plain letter'],
    ['Shift+N', 'typing chord'],
    ['Alt+N', 'no Mod'],
    ['Enter', 'plain key'],
    ['Space', 'plain key'],
    ['Escape', 'plain key'],
    ['Mod+Tab', 'unbindable key'],
    ['Mod+Escape', 'unbindable key'],
    ['Mod+ArrowUp', 'navigation key'],
    ['Mod+Backspace', 'text editing'],
    ['Mod+Delete', 'text editing'],
    ['Mod+N+M', 'two keys'],
    [' Mod+N', 'whitespace'],
  ])('rejects %s (%s)', (s) => {
    expect(validateActionShortcut(s)).not.toBeNull();
  });

  it.each([
    'Mod+K',
    'Mod+,',
    'Mod+P',
    'Mod+Q',
    'Mod+A',
    'Mod+C',
    'Mod+V',
    'Mod+X',
    'Mod+Z',
    'Mod+Y',
    'Mod+Shift+Z',
  ])('rejects reserved %s', (s) => {
    expect(RESERVED_ACTION_SHORTCUTS.has(s)).toBe(true);
    expect(validateActionShortcut(s)).toMatch(/reserved/i);
  });

  it('assertActionShortcut throws with the offending value', () => {
    expect(() => assertActionShortcut('⌘N', 'notes:add')).toThrow(/notes:add.*⌘N/);
    expect(() => assertActionShortcut('Mod+N', 'notes:add')).not.toThrow();
  });
});

describe('eventToActionChord', () => {
  it('maps ⌘ to Mod on macOS', () => {
    expect(eventToActionChord(ev({ key: 'n', code: 'KeyN', metaKey: true }), 'macos')).toBe(
      'Mod+N',
    );
  });

  it('maps Ctrl to Mod on Windows and Linux', () => {
    for (const p of ['windows', 'other'] as ActionShortcutPlatform[]) {
      expect(eventToActionChord(ev({ key: 'n', code: 'KeyN', ctrlKey: true }), p)).toBe('Mod+N');
    }
  });

  it('never treats macOS Ctrl+N as Mod+N', () => {
    expect(eventToActionChord(ev({ key: 'n', code: 'KeyN', ctrlKey: true }), 'macos')).toBeNull();
  });

  it('never treats the Windows/Super key as Mod on Windows and Linux', () => {
    expect(eventToActionChord(ev({ key: 'n', code: 'KeyN', metaKey: true }), 'windows')).toBeNull();
    expect(eventToActionChord(ev({ key: 'n', code: 'KeyN', metaKey: true }), 'other')).toBeNull();
  });

  it('rejects both ⌘ and Ctrl held together', () => {
    expect(
      eventToActionChord(ev({ key: 'n', code: 'KeyN', metaKey: true, ctrlKey: true }), 'macos'),
    ).toBeNull();
  });

  it('orders modifiers canonically', () => {
    expect(
      eventToActionChord(
        ev({ key: 'C', code: 'KeyC', metaKey: true, shiftKey: true, altKey: true }),
        'macos',
      ),
    ).toBe('Mod+Alt+Shift+C');
  });

  it('uses the physical key so Shift/Alt do not change it', () => {
    expect(
      eventToActionChord(ev({ key: '<', code: 'Comma', metaKey: true, shiftKey: true }), 'macos'),
    ).toBe('Mod+Shift+,');
  });

  it('falls back to event.key when code is absent (synthetic iframe events)', () => {
    expect(eventToActionChord(ev({ key: 'c', metaKey: true, shiftKey: true }), 'macos')).toBe(
      'Mod+Shift+C',
    );
  });

  it('returns null for a bare modifier press', () => {
    expect(
      eventToActionChord(ev({ key: 'Meta', code: 'MetaLeft', metaKey: true }), 'macos'),
    ).toBeNull();
  });

  it('allows bare F-keys', () => {
    expect(eventToActionChord(ev({ key: 'F5', code: 'F5' }), 'macos')).toBe('F5');
  });

  it('returns null for plain keys', () => {
    expect(eventToActionChord(ev({ key: 'n', code: 'KeyN' }), 'macos')).toBeNull();
    expect(eventToActionChord(ev({ key: 'Enter', code: 'Enter' }), 'macos')).toBeNull();
  });
});

describe('eventToActionChord: keyboard layouts', () => {
  it('follows the layout character for letters (Dvorak ⌘C is still copy)', () => {
    // On Dvorak the key that types "c" is the physical KeyI.
    expect(eventToActionChord(ev({ key: 'c', code: 'KeyI', metaKey: true }), 'macos')).toBe(
      'Mod+C',
    );
  });

  it('falls back to the physical key when the layout character is not ASCII', () => {
    // Cyrillic layout: the KeyN key types "т".
    expect(eventToActionChord(ev({ key: 'т', code: 'KeyN', ctrlKey: true }), 'windows')).toBe(
      'Mod+N',
    );
    // macOS ⌥ turns the character into a symbol; the binding stays on N.
    expect(
      eventToActionChord(ev({ key: '˜', code: 'KeyN', metaKey: true, altKey: true }), 'macos'),
    ).toBe('Mod+Alt+N');
  });

  it('never treats AltGr (Ctrl+Alt on Windows) as an action chord', () => {
    const e = ev({ key: 'ć', code: 'KeyC', ctrlKey: true, altKey: true });
    Object.defineProperty(e, 'getModifierState', { value: (k: string) => k === 'AltGraph' });
    expect(eventToActionChord(e, 'windows')).toBeNull();
  });
});

describe('resolveActionChord', () => {
  it('resolves Mod to the physical modifier the iframe can see', () => {
    expect(resolveActionChord('Mod+Shift+C', 'macos')).toBe('Super+Shift+C');
    expect(resolveActionChord('Mod+Shift+C', 'windows')).toBe('Control+Shift+C');
    expect(resolveActionChord('Mod+Alt+N', 'other')).toBe('Control+Alt+N');
  });

  it('leaves bare F-keys alone', () => {
    expect(resolveActionChord('F5', 'macos')).toBe('F5');
  });
});
