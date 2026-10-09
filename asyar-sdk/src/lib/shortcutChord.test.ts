import { describe, it, expect } from 'vitest';
import { chordFromKeyboardEvent } from './shortcutChord';

const ev = (init: Partial<KeyboardEvent> & { key: string }) =>
  ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent;

describe('chordFromKeyboardEvent', () => {
  it('spells ⌘ chords with Super', () => {
    expect(chordFromKeyboardEvent(ev({ key: 'n', code: 'KeyN', metaKey: true }))).toBe('Super+N');
  });

  it('spells Ctrl chords with Control', () => {
    expect(chordFromKeyboardEvent(ev({ key: 'n', code: 'KeyN', ctrlKey: true }))).toBe('Control+N');
  });

  it('orders the modifiers primary, Alt, Shift', () => {
    expect(
      chordFromKeyboardEvent(
        ev({ key: 'C', code: 'KeyC', metaKey: true, altKey: true, shiftKey: true }),
      ),
    ).toBe('Super+Alt+Shift+C');
  });

  it('uses the physical key, not the shifted character', () => {
    expect(
      chordFromKeyboardEvent(ev({ key: '<', code: 'Comma', metaKey: true, shiftKey: true })),
    ).toBe('Super+Shift+,');
    expect(chordFromKeyboardEvent(ev({ key: '!', code: 'Digit1', ctrlKey: true }))).toBe(
      'Control+1',
    );
  });

  it('falls back to event.key when code is empty', () => {
    expect(chordFromKeyboardEvent(ev({ key: 'n', metaKey: true }))).toBe('Super+N');
    expect(chordFromKeyboardEvent(ev({ key: ' ', metaKey: true }))).toBe('Super+Space');
  });

  it('names Enter and Space', () => {
    expect(chordFromKeyboardEvent(ev({ key: 'Enter', code: 'Enter', metaKey: true }))).toBe(
      'Super+Enter',
    );
    expect(chordFromKeyboardEvent(ev({ key: ' ', code: 'Space', ctrlKey: true }))).toBe(
      'Control+Space',
    );
  });

  it('is null when ⌘ and Ctrl are both held', () => {
    expect(
      chordFromKeyboardEvent(ev({ key: 'n', code: 'KeyN', metaKey: true, ctrlKey: true })),
    ).toBeNull();
  });

  it('is null for plain and Shift/Alt-only keys, which are typing', () => {
    expect(chordFromKeyboardEvent(ev({ key: 'n', code: 'KeyN' }))).toBeNull();
    expect(chordFromKeyboardEvent(ev({ key: 'N', code: 'KeyN', shiftKey: true }))).toBeNull();
    expect(chordFromKeyboardEvent(ev({ key: 'n', code: 'KeyN', altKey: true }))).toBeNull();
  });

  it('is null for a lone modifier press', () => {
    expect(chordFromKeyboardEvent(ev({ key: 'Meta', code: 'MetaLeft', metaKey: true }))).toBeNull();
  });

  it('allows a bare F-key', () => {
    expect(chordFromKeyboardEvent(ev({ key: 'F5', code: 'F5' }))).toBe('F5');
    expect(chordFromKeyboardEvent(ev({ key: 'F5', code: 'F5', shiftKey: true }))).toBeNull();
  });

  it('follows the layout character for letters (Dvorak ⌘C stays copy)', () => {
    expect(chordFromKeyboardEvent(ev({ key: 'c', code: 'KeyI', metaKey: true }))).toBe('Super+C');
  });

  it('falls back to the physical key for non-Latin and ⌥-composed characters', () => {
    expect(chordFromKeyboardEvent(ev({ key: 'т', code: 'KeyN', ctrlKey: true }))).toBe('Control+N');
    expect(
      chordFromKeyboardEvent(ev({ key: '˜', code: 'KeyN', metaKey: true, altKey: true })),
    ).toBe('Super+Alt+N');
  });

  it('is null for AltGr, which types characters', () => {
    const e = ev({ key: 'ć', code: 'KeyC', ctrlKey: true, altKey: true });
    (e as unknown as { getModifierState: (k: string) => boolean }).getModifierState = (k) =>
      k === 'AltGraph';
    expect(chordFromKeyboardEvent(e)).toBeNull();
  });
});
