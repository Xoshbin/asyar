import { describe, it, expect, vi, beforeEach } from 'vitest'
import { settingsService } from './settingsService.svelte'
import type { AppSettings } from './types/AppSettingsType'

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

const DEFAULT: AppSettings = {
  general: { startAtLogin: false, showDockIcon: true, escapeInViewBehavior: 'close-window' },
  search: {
    searchApplications: true,
    searchSystemPreferences: true,
    fuzzySearch: true,
    enableExtensionSearch: false,
    allowExtensionActions: false,
    additionalScanPaths: [],
  },
  shortcut: { modifier: 'Alt', key: 'Space' },
  appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
  extensions: {
    enabled: {},
    autoUpdate: true,
  },
  updates: {
    channel: 'stable',
  },
  ai: {
    providers: {
      openai: { enabled: false },
      anthropic: { enabled: false },
      google: { enabled: false },
      ollama: { enabled: false },
      openrouter: { enabled: false },
      custom: { enabled: false },
    },
    activeProviderId: null,
    activeModelId: null,
    allowExtensionUse: true,
    temperature: 0.7,
    maxTokens: 2048,
  },
}

const svc = settingsService as any

function resetState() {
  svc.currentSettings = JSON.parse(JSON.stringify(DEFAULT))
  svc.initialized = false
  svc.store = null
}

function injectStore() {
  mockTauriStore.get.mockResolvedValue(null)
  mockTauriStore.set.mockResolvedValue(undefined)
  mockTauriStore.save.mockResolvedValue(undefined)
  svc.store = mockTauriStore
}

// ── mergeWithDefaults ─────────────────────────────────────────────────────────

describe('mergeWithDefaults', () => {
  const merge = (stored: unknown) => svc.mergeWithDefaults(stored)

  it('returns a copy of defaults for null', () => {
    const result = merge(null)
    expect(result.general.startAtLogin).toBe(false)
    expect(result.shortcut.key).toBe('Space')
  })

  it('returns defaults for a non-object value', () => {
    const result = merge('bad input')
    expect(result.appearance.theme).toBe('system')
  })

  it('fills all default fields when stored is an empty object', () => {
    const result = merge({})
    expect(result.general).toEqual(DEFAULT.general)
    expect(result.search).toEqual(DEFAULT.search)
    expect(result.appearance).toEqual(DEFAULT.appearance)
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

  it('returns or reflects the current state', () => {
    const s = settingsService.getSettings()
    expect(s.shortcut).toEqual({ modifier: 'Alt', key: 'Space' })
  })

  it('reflects changes made directly to currentSettings', () => {
    svc.currentSettings.shortcut = { modifier: 'Ctrl', key: 'P' }
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
    svc.initialized = true
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
    svc.currentSettings.extensions.enabled.myExt = false
    expect(settingsService.isExtensionEnabled('myExt')).toBe(false)
  })

  it('returns true for an extension explicitly enabled', () => {
    svc.currentSettings.extensions.enabled.myExt = true
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
    svc.currentSettings.extensions.enabled = { a: true, b: false }
    expect(settingsService.getExtensionStates()).toEqual({ a: true, b: false })
  })
})

// ── updateSettings ────────────────────────────────────────────────────────────

describe('updateSettings', () => {
  beforeEach(() => {
    resetState()
    injectStore()
  })

  it('updates the in-memory state and returns true', async () => {
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
    svc.store = null
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
    svc.currentSettings.extensions.enabled.other = true
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
    svc.currentSettings.extensions.enabled.toRemove = true
    await settingsService.removeExtensionState('toRemove')
    expect('toRemove' in settingsService.getSettings().extensions.enabled).toBe(false)
  })

  it('does not affect other extensions when removing one', async () => {
    svc.currentSettings.extensions.enabled = { keep: true, remove: false }
    await settingsService.removeExtensionState('remove')
    expect(settingsService.getSettings().extensions.enabled.keep).toBe(true)
  })

  it('is a no-op when the extension does not exist', async () => {
    await expect(settingsService.removeExtensionState('nonexistent')).resolves.toBeDefined()
  })
})

// ── Rust read_launch_view contract ────────────────────────────────────────────
//
// Rust's `read_launch_view` in `src-tauri/src/lib.rs` navigates the JSON path
// `appearance → launchView` on the value stored under the `"settings"` key in
// `settings.dat`. That path is hardcoded in Rust — renaming any key on the TS
// side silently breaks compact-launcher first-frame seeding (Rust falls back
// to "default", compact users see a 560→96 reflow flash).
//
// This block pins the contract: if someone renames `appearance` or
// `launchView`, these tests fail and point at `lib.rs::parse_launch_view` and
// its sibling `launch_view_tests` module.

describe('rust read_launch_view contract', () => {
  // Round-trip through JSON so we're asserting against the exact shape Rust
  // sees (not TS-only sugar like Symbol keys or class instances).
  const serializedDefaults = JSON.parse(JSON.stringify(DEFAULT))

  it('exposes launchView at appearance.launchView', () => {
    expect(serializedDefaults.appearance).toBeDefined()
    expect(typeof serializedDefaults.appearance.launchView).toBe('string')
  })

  it('uses one of the enum values Rust checks against', () => {
    expect(['default', 'compact']).toContain(serializedDefaults.appearance.launchView)
  })

  it('keeps the appearance key at the top level (not nested under ui/window/etc.)', () => {
    const topLevelKeys = Object.keys(serializedDefaults)
    expect(topLevelKeys).toContain('appearance')
  })
})
