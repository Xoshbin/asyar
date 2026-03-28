import { describe, it, expect } from 'vitest'
import {
  toDisplayString,
  fromKeyboardEvent,
  parseShortcut,
  isValid,
  MODIFIER_KEYS,
} from './shortcutFormatter'

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
    expect(fromKeyboardEvent(makeEvent({ key: 'k', metaKey: true }))).toBe('Super+K')
  })

  it('builds Control+C from ctrlKey + c', () => {
    expect(fromKeyboardEvent(makeEvent({ key: 'c', ctrlKey: true }))).toBe('Control+C')
  })

  it('builds Alt+Space from altKey + space', () => {
    expect(fromKeyboardEvent(makeEvent({ key: ' ', altKey: true }))).toBe('Alt+Space')
  })

  it('builds Shift+A from shiftKey + a', () => {
    expect(fromKeyboardEvent(makeEvent({ key: 'a', shiftKey: true }))).toBe('Shift+A')
  })

  it('combines multiple modifiers in correct order (Super > Control > Alt > Shift)', () => {
    const result = fromKeyboardEvent(makeEvent({ key: 'k', metaKey: true, shiftKey: true }))
    expect(result).toBe('Super+Shift+K')
  })

  it('uppercases the key', () => {
    expect(fromKeyboardEvent(makeEvent({ key: 'f', metaKey: true }))).toBe('Super+F')
  })

  it('returns just the uppercased key with no modifiers held', () => {
    expect(fromKeyboardEvent(makeEvent({ key: 'a' }))).toBe('A')
  })
})
