import { describe, it, expect, vi, beforeEach } from 'vitest'

const updateShortcut = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('../../../utils/shortcutManager', () => ({
  updateShortcut,
}))

import { saveHotkey } from './summonSearchSetup'

describe('SummonSearch saveHotkey', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists the chosen modifier+key', async () => {
    await saveHotkey({ modifier: 'Super', key: 'K' })
    expect(updateShortcut).toHaveBeenCalledWith('Super', 'K')
  })

  it('returns true on success', async () => {
    updateShortcut.mockResolvedValue(true)
    const result = await saveHotkey({ modifier: 'Alt', key: 'Space' })
    expect(result).toBe(true)
  })

  it('returns error string when updateShortcut fails', async () => {
    updateShortcut.mockResolvedValue(false)
    const result = await saveHotkey({ modifier: 'Alt', key: 'Space' })
    expect(result).toBe('Could not set that shortcut')
  })
})
