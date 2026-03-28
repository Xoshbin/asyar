import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockUpdateSettings = vi.hoisted(() => vi.fn().mockResolvedValue(true))

vi.mock('../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))

vi.mock('../services/settings/settingsService.svelte', () => ({
  settingsService: { updateSettings: mockUpdateSettings },
}))

import { updateShortcut, getAvailableModifiers, getAvailableKeys } from './shortcutManager'

// ── getAvailableModifiers ─────────────────────────────────────────────────────

describe('getAvailableModifiers', () => {
  it('returns exactly the four standard modifiers', () => {
    expect(getAvailableModifiers()).toEqual(['Alt', 'Ctrl', 'Shift', 'Super'])
  })

  it('returns the same array reference on repeated calls', () => {
    expect(getAvailableModifiers()).toBe(getAvailableModifiers())
  })
})

// ── getAvailableKeys ──────────────────────────────────────────────────────────

describe('getAvailableKeys', () => {
  it('includes all letters A–Z', () => {
    const keys = getAvailableKeys()
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(keys).toContain(ch)
    }
  })

  it('includes digits 0–9', () => {
    const keys = getAvailableKeys()
    for (const d of '0123456789') {
      expect(keys).toContain(d)
    }
  })

  it('includes function keys F1–F12', () => {
    const keys = getAvailableKeys()
    for (let i = 1; i <= 12; i++) {
      expect(keys).toContain(`F${i}`)
    }
  })

  it('includes common special keys', () => {
    const keys = getAvailableKeys()
    for (const key of ['Space', 'Tab', 'Home', 'End', 'PageUp', 'PageDown',
                        'Insert', 'Delete', 'Right', 'Left', 'Down', 'Up']) {
      expect(keys).toContain(key)
    }
  })

  it('includes punctuation keys', () => {
    const keys = getAvailableKeys()
    for (const key of [';', '=', ',', '-', '.', '/', '\\', "'", '[', ']']) {
      expect(keys).toContain(key)
    }
  })

  it('returns the same array reference on repeated calls', () => {
    expect(getAvailableKeys()).toBe(getAvailableKeys())
  })
})

// ── updateShortcut ────────────────────────────────────────────────────────────

describe('updateShortcut', () => {
  beforeEach(() => {
    mockInvoke.mockClear()
    mockUpdateSettings.mockClear()
  })

  it('calls invoke with update_global_shortcut and the correct args', async () => {
    await updateShortcut('Super', 'K')
    expect(mockInvoke).toHaveBeenCalledWith('update_global_shortcut', { modifier: 'Super', key: 'K' })
  })

  it('calls settingsService.updateSettings with the shortcut after invoke', async () => {
    await updateShortcut('Alt', 'Space')
    expect(mockUpdateSettings).toHaveBeenCalledWith('shortcut', { modifier: 'Alt', key: 'Space' })
  })

  it('returns true when both invoke and updateSettings succeed', async () => {
    mockUpdateSettings.mockResolvedValueOnce(true)
    expect(await updateShortcut('Super', 'K')).toBe(true)
  })

  it('returns false when updateSettings returns false', async () => {
    mockUpdateSettings.mockResolvedValueOnce(false)
    expect(await updateShortcut('Super', 'K')).toBe(false)
  })

  it('returns false when invoke rejects', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('shortcut already registered'))
    expect(await updateShortcut('Super', 'K')).toBe(false)
  })

  it('returns false when updateSettings rejects', async () => {
    mockUpdateSettings.mockRejectedValueOnce(new Error('store write failed'))
    expect(await updateShortcut('Ctrl', 'J')).toBe(false)
  })

  it('does not call updateSettings when invoke fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('fail'))
    await updateShortcut('Super', 'K')
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })
})
