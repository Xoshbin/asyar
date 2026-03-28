import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

const mockTauriStore = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue(mockTauriStore),
  Store: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/data/'),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))

import { settingsService, settings } from './settingsService'
import type { AppSettings } from './types/AppSettingsType'

const DEFAULT: AppSettings = {
  general: { startAtLogin: false, showDockIcon: true, escapeInViewBehavior: 'close-window' },
  search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true, enableExtensionSearch: false },
  shortcut: { modifier: 'Super', key: 'K' },
  appearance: { theme: 'system', windowWidth: 800, windowHeight: 600 },
  extensions: { enabled: {} },
  calculator: { refreshInterval: 6 },
}

function resetState() {
  settings.set({ ...DEFAULT, extensions: { enabled: {} } })
  ;(settingsService as any).initialized = false
  ;(settingsService as any).store = null
}

function injectStore() {
  mockTauriStore.get.mockResolvedValue(null)
  mockTauriStore.set.mockResolvedValue(undefined)
  mockTauriStore.save.mockResolvedValue(undefined)
  ;(settingsService as any).store = mockTauriStore
}

// ── mergeWithDefaults ─────────────────────────────────────────────────────────

describe('mergeWithDefaults', () => {
  const merge = (stored: unknown) => (settingsService as any).mergeWithDefaults(stored)

  it('returns a copy of defaults for null', () => {
    const result = merge(null)
    expect(result.general.startAtLogin).toBe(false)
    expect(result.shortcut.key).toBe('K')
  })

  it('returns defaults for a non-object value', () => {
    const result = merge('bad input')
    expect(result.appearance.theme).toBe('system')
  })

  it('fills all default fields when stored is an empty object', () => {
    const result = merge({})
    expect(result.general).toEqual(DEFAULT.general)
    expect(result.search).toEqual(DEFAULT.search)
    expect(result.calculator).toEqual(DEFAULT.calculator)
  })

  it('overrides individual fields while keeping other defaults', () => {
    const result = merge({ shortcut: { modifier: 'Alt', key: 'Space' } })
    expect(result.shortcut.modifier).toBe('Alt')
    expect(result.shortcut.key).toBe('Space')
    expect(result.general.startAtLogin).toBe(DEFAULT.general.startAtLogin)
  })

  it('merges extension enabled states', () => {
    const result = merge({ extensions: { enabled: { clipboard: false, store: true } } })
    expect(result.extensions.enabled.clipboard).toBe(false)
    expect(result.extensions.enabled.store).toBe(true)
  })

  it('preserves the user field when present', () => {
    const result = merge({ user: { id: 'u1', syncEnabled: true } })
    expect(result.user).toEqual({ id: 'u1', syncEnabled: true })
  })

  it('sets user to undefined when not in stored data', () => {
    const result = merge({})
    expect(result.user).toBeUndefined()
  })

  it('overrides only the provided appearance fields', () => {
    const result = merge({ appearance: { theme: 'dark' } })
    expect(result.appearance.theme).toBe('dark')
    expect(result.appearance.windowWidth).toBe(DEFAULT.appearance.windowWidth)
  })
})

// ── getSettings ───────────────────────────────────────────────────────────────

describe('getSettings', () => {
  beforeEach(resetState)

  it('returns the current store value', () => {
    const s = settingsService.getSettings()
    expect(s.shortcut).toEqual({ modifier: 'Super', key: 'K' })
  })

  it('reflects changes made directly to the store', () => {
    settings.update(s => ({ ...s, shortcut: { modifier: 'Ctrl', key: 'P' } }))
    expect(settingsService.getSettings().shortcut.key).toBe('P')
  })
})

// ── isInitialized ─────────────────────────────────────────────────────────────

describe('isInitialized', () => {
  beforeEach(resetState)

  it('returns false on a fresh reset', () => {
    expect(settingsService.isInitialized()).toBe(false)
  })

  it('returns true after being manually set (simulating init)', () => {
    ;(settingsService as any).initialized = true
    expect(settingsService.isInitialized()).toBe(true)
  })
})

// ── isExtensionEnabled ────────────────────────────────────────────────────────

describe('isExtensionEnabled', () => {
  beforeEach(resetState)

  it('returns true for an extension that has no explicit setting', () => {
    expect(settingsService.isExtensionEnabled('myExt')).toBe(true)
  })

  it('returns false for an extension explicitly disabled', () => {
    settings.update(s => ({ ...s, extensions: { enabled: { myExt: false } } }))
    expect(settingsService.isExtensionEnabled('myExt')).toBe(false)
  })

  it('returns true for an extension explicitly enabled', () => {
    settings.update(s => ({ ...s, extensions: { enabled: { myExt: true } } }))
    expect(settingsService.isExtensionEnabled('myExt')).toBe(true)
  })
})

// ── getExtensionStates ────────────────────────────────────────────────────────

describe('getExtensionStates', () => {
  beforeEach(resetState)

  it('returns an empty object with default settings', () => {
    expect(settingsService.getExtensionStates()).toEqual({})
  })

  it('returns all extension states', () => {
    settings.update(s => ({
      ...s,
      extensions: { enabled: { a: true, b: false } },
    }))
    expect(settingsService.getExtensionStates()).toEqual({ a: true, b: false })
  })
})

// ── updateSettings ────────────────────────────────────────────────────────────

describe('updateSettings', () => {
  beforeEach(() => {
    resetState()
    injectStore()
  })

  it('updates the in-memory store and returns true', async () => {
    const ok = await settingsService.updateSettings('shortcut', { key: 'J' })
    expect(ok).toBe(true)
    expect(settingsService.getSettings().shortcut.key).toBe('J')
  })

  it('merges into the section without clobbering other fields', async () => {
    await settingsService.updateSettings('search', { fuzzySearch: false })
    const s = settingsService.getSettings().search
    expect(s.fuzzySearch).toBe(false)
    expect(s.searchApplications).toBe(true)
  })

  it('returns false (save fails) when the store is not initialized', async () => {
    ;(settingsService as any).store = null
    const ok = await settingsService.updateSettings('shortcut', { key: 'X' })
    expect(ok).toBe(false)
    // In-memory change still happened
    expect(settingsService.getSettings().shortcut.key).toBe('X')
  })
})

// ── updateExtensionState ──────────────────────────────────────────────────────

describe('updateExtensionState', () => {
  beforeEach(() => {
    resetState()
    injectStore()
  })

  it('sets an extension to enabled', async () => {
    await settingsService.updateExtensionState('clipboard', true)
    expect(settingsService.getSettings().extensions.enabled.clipboard).toBe(true)
  })

  it('sets an extension to disabled', async () => {
    await settingsService.updateExtensionState('clipboard', false)
    expect(settingsService.getSettings().extensions.enabled.clipboard).toBe(false)
  })

  it('updating one extension does not affect others', async () => {
    settings.update(s => ({ ...s, extensions: { enabled: { other: true } } }))
    await settingsService.updateExtensionState('clipboard', false)
    expect(settingsService.getSettings().extensions.enabled.other).toBe(true)
  })
})

// ── removeExtensionState ──────────────────────────────────────────────────────

describe('removeExtensionState', () => {
  beforeEach(() => {
    resetState()
    injectStore()
  })

  it('removes an extension entry entirely', async () => {
    settings.update(s => ({ ...s, extensions: { enabled: { toRemove: true } } }))
    await settingsService.removeExtensionState('toRemove')
    expect('toRemove' in settingsService.getSettings().extensions.enabled).toBe(false)
  })

  it('does not affect other extensions when removing one', async () => {
    settings.update(s => ({ ...s, extensions: { enabled: { keep: true, remove: false } } }))
    await settingsService.removeExtensionState('remove')
    expect(settingsService.getSettings().extensions.enabled.keep).toBe(true)
  })

  it('is a no-op when the extension does not exist', async () => {
    await expect(settingsService.removeExtensionState('nonexistent')).resolves.toBeDefined()
  })
})

// ── subscribe ─────────────────────────────────────────────────────────────────

describe('subscribe', () => {
  beforeEach(resetState)

  it('calls the callback immediately with current settings', () => {
    const cb = vi.fn()
    const unsub = settingsService.subscribe(cb)
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ shortcut: { modifier: 'Super', key: 'K' } }))
    unsub()
  })

  it('calls the callback again when settings change', () => {
    const cb = vi.fn()
    const unsub = settingsService.subscribe(cb)
    settings.update(s => ({ ...s, shortcut: { modifier: 'Alt', key: 'Q' } }))
    expect(cb).toHaveBeenCalledTimes(2)
    unsub()
  })
})
