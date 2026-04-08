import { describe, it, expect, beforeEach } from 'vitest'
import {
  toDisplayString,
  fromKeyboardEvent,
  parseShortcut,
  isValid,
  isValidKey,
  normalizeShortcut,
  MODIFIER_KEYS,
  CODE_TO_KEY,
  VALID_KEYS,
  MODIFIER_SYMBOL,
  MODIFIER_ORDER,
  KEY_DISPLAY,
  DOM_TO_MODIFIER,
} from './shortcutFormatter'

beforeEach(() => {
  VALID_KEYS.clear();
  // Populate with common keys used in tests
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
   'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
   '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'F1', 'F12',
   'Space', '/', '-', 'ArrowUp', 'Home'].forEach(k => VALID_KEYS.add(k));
});

// ── toDisplayString ───────────────────────────────────────────────────────────

describe('toDisplayString', () => {
  it('converts Super to ⌘', () => {
    expect(toDisplayString('Super+K')).toBe('⌘K')
  })

  it('converts Shift to ⇧', () => {
    expect(toDisplayString('Shift+A')).toBe('⇧A')
  })

  it('converts Alt to ⌥', () => {
    expect(toDisplayString('Alt+Space')).toBe('⌥Space')
  })

  it('converts Control to ⌃', () => {
    expect(toDisplayString('Control+C')).toBe('⌃C')
  })

  it('handles multi-modifier shortcuts', () => {
    expect(toDisplayString('Super+Shift+K')).toBe('⌘⇧K')
  })

  it('removes all + separators', () => {
    expect(toDisplayString('Super+Alt+F')).toBe('⌘⌥F')
  })

  it('leaves plain keys unchanged', () => {
    expect(toDisplayString('K')).toBe('K')
  })
})

// ── parseShortcut ─────────────────────────────────────────────────────────────

describe('parseShortcut', () => {
  it('splits single-modifier shortcut into [modifier, key]', () => {
    expect(parseShortcut('Super+K')).toEqual(['Super', 'K'])
  })

  it('splits multi-modifier shortcut — key is last part, modifier is rest', () => {
    expect(parseShortcut('Super+Shift+K')).toEqual(['Super+Shift', 'K'])
  })

  it('works with Alt modifier', () => {
    expect(parseShortcut('Alt+Space')).toEqual(['Alt', 'Space'])
  })

  it('works with function keys', () => {
    expect(parseShortcut('Control+F12')).toEqual(['Control', 'F12'])
  })

  it('works with three modifiers', () => {
    expect(parseShortcut('Super+Shift+Alt+X')).toEqual(['Super+Shift+Alt', 'X'])
  })
})

// ── isValid ───────────────────────────────────────────────────────────────────

describe('isValid', () => {
  it('returns true for a valid single-modifier shortcut', () => {
    expect(isValid('Super+K')).toBe(true)
  })

  it('returns true for multi-modifier shortcut', () => {
    expect(isValid('Super+Shift+K')).toBe(true)
  })

  it('returns true with each accepted modifier', () => {
    for (const mod of ['Super', 'Control', 'Alt', 'Shift']) {
      expect(isValid(`${mod}+A`)).toBe(true)
    }
  })

  it('returns false when there is only one part (no +)', () => {
    expect(isValid('K')).toBe(false)
  })

  it('returns false when no recognised modifier is present', () => {
    expect(isValid('Foo+K')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isValid('')).toBe(false)
  })
})

// ── fromKeyboardEvent ─────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: 'a',
    code: 'KeyA',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as unknown as KeyboardEvent
}

describe('fromKeyboardEvent', () => {
  it('returns null when the pressed key is a modifier key', () => {
    for (const key of MODIFIER_KEYS) {
      expect(fromKeyboardEvent(makeEvent({ key }))).toBeNull()
    }
  })

  it('builds Super+K from metaKey + k', () => {
    expect(fromKeyboardEvent(makeEvent({ key: 'k', code: 'KeyK', metaKey: true }))).toBe('Super+K')
  })

  it('builds Control+C from ctrlKey + c', () => {
    expect(fromKeyboardEvent(makeEvent({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBe('Control+C')
  })

  it('builds Alt+Space from altKey + space', () => {
    expect(fromKeyboardEvent(makeEvent({ key: ' ', code: 'Space', altKey: true }))).toBe('Alt+Space')
  })

  it('builds Shift+A from shiftKey + a', () => {
    expect(fromKeyboardEvent(makeEvent({ key: 'A', code: 'KeyA', shiftKey: true }))).toBe('Shift+A')
  })

  it('combines multiple modifiers in correct order (Super > Control > Alt > Shift)', () => {
    const result = fromKeyboardEvent(makeEvent({ key: 'k', code: 'KeyK', metaKey: true, shiftKey: true }))
    expect(result).toBe('Super+Shift+K')
  })

  it('uses event.code to resolve physical key, ignoring Shift modification', () => {
    // Shift + / produces '?' as event.key but code is still 'Slash'
    const result = fromKeyboardEvent(makeEvent({ key: '?', code: 'Slash', shiftKey: true }))
    expect(result).toBe('Shift+/')
  })

  it('returns just the key with no modifiers held', () => {
    expect(fromKeyboardEvent(makeEvent({ key: 'a', code: 'KeyA' }))).toBe('A')
  })

  it('falls back to event.key when code is not mapped', () => {
    expect(fromKeyboardEvent(makeEvent({ key: 'x', code: 'UnknownCode' }))).toBe('X')
  })
})

// ── isValidKey ────────────────────────────────────────────────────────────────

describe('isValidKey', () => {
  it('accepts letters', () => {
    expect(isValidKey('A')).toBe(true)
    expect(isValidKey('Z')).toBe(true)
  })

  it('accepts digits', () => {
    expect(isValidKey('0')).toBe(true)
    expect(isValidKey('9')).toBe(true)
  })

  it('accepts function keys', () => {
    expect(isValidKey('F1')).toBe(true)
    expect(isValidKey('F12')).toBe(true)
  })

  it('accepts Space', () => {
    expect(isValidKey('Space')).toBe(true)
  })

  it('accepts punctuation keys', () => {
    expect(isValidKey('/')).toBe(true)
    expect(isValidKey('-')).toBe(true)
  })

  it('accepts navigation keys', () => {
    expect(isValidKey('ArrowUp')).toBe(true)
    expect(isValidKey('Home')).toBe(true)
  })

  it('rejects Enter', () => {
    expect(isValidKey('Enter')).toBe(false)
  })

  it('rejects Backspace', () => {
    expect(isValidKey('Backspace')).toBe(false)
  })

  it('rejects Tab', () => {
    expect(isValidKey('Tab')).toBe(false)
  })

  it('rejects arbitrary strings', () => {
    expect(isValidKey('foo')).toBe(false)
  })
})

// ── normalizeShortcut ─────────────────────────────────────────────────────────

describe('normalizeShortcut', () => {
  it('replaces Ctrl with Control', () => {
    expect(normalizeShortcut('Ctrl+K')).toBe('Control+K')
  })

  it('leaves Control unchanged', () => {
    expect(normalizeShortcut('Control+K')).toBe('Control+K')
  })

  it('handles multi-modifier with Ctrl', () => {
    expect(normalizeShortcut('Ctrl+Shift+A')).toBe('Control+Shift+A')
  })

  it('does not affect non-modifier occurrences', () => {
    expect(normalizeShortcut('Super+K')).toBe('Super+K')
  })
})

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('CODE_TO_KEY maps all letter codes', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(CODE_TO_KEY[`Key${ch}`]).toBe(ch)
    }
  })

  it('CODE_TO_KEY maps digit codes', () => {
    for (let i = 0; i <= 9; i++) {
      expect(CODE_TO_KEY[`Digit${i}`]).toBe(String(i))
    }
  })

  it('CODE_TO_KEY maps punctuation codes', () => {
    expect(CODE_TO_KEY['Slash']).toBe('/')
    expect(CODE_TO_KEY['Minus']).toBe('-')
  })

  it('VALID_KEYS does not include Enter, Backspace, or Tab', () => {
    expect(VALID_KEYS.has('Enter')).toBe(false)
    expect(VALID_KEYS.has('Backspace')).toBe(false)
    expect(VALID_KEYS.has('Tab')).toBe(false)
  })

  it('MODIFIER_SYMBOL has all four modifiers', () => {
    expect(Object.keys(MODIFIER_SYMBOL)).toEqual(['Super', 'Shift', 'Alt', 'Control'])
  })

  it('MODIFIER_ORDER follows Apple HIG', () => {
    expect(MODIFIER_ORDER).toEqual(['Control', 'Alt', 'Shift', 'Super'])
  })

  it('KEY_DISPLAY maps arrow keys to symbols', () => {
    expect(KEY_DISPLAY['ArrowUp']).toBe('↑')
    expect(KEY_DISPLAY['ArrowRight']).toBe('→')
  })

  it('DOM_TO_MODIFIER maps Meta to Super', () => {
    expect(DOM_TO_MODIFIER['Meta']).toBe('Super')
  })
})
