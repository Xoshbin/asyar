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

import { updateShortcut } from './shortcutManager'

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
    expect(await updateShortcut('Control', 'J')).toBe(false)
  })

  it('does not call updateSettings when invoke fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('fail'))
    await updateShortcut('Super', 'K')
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })
})
