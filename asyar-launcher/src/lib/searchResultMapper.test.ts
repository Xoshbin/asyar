import { describe, it, expect, vi } from 'vitest'

// Mock logService before importing (it calls Tauri log plugin at module level)
vi.mock('../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../services/extension/extensionManager.svelte', () => ({
  __esModule: true,
  default: {
    getManifestById: vi.fn(),
    handleCommandAction: vi.fn().mockResolvedValue(undefined),
  },
}))

import extensionManager from '../services/extension/extensionManager.svelte'

vi.mock('../services/application/applicationsService', () => ({
  applicationService: {
    open: vi.fn(),
  },
}))

import { resolveItemMeta, buildMappedItems } from './searchResultMapper'
import type { SearchResult } from '../services/search/interfaces/SearchResult'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    objectId: 'test-id',
    name: 'Test Item',
    type: 'command',
    score: 0.5,
    ...overrides,
  } as SearchResult
}

const noManifest = (_id: string) => null

// ── Icon resolution ───────────────────────────────────────────────────────────

describe('icon resolution', () => {
  it('uses the result icon when provided', () => {
    const { icon } = resolveItemMeta(makeResult({ icon: '🎯' }), noManifest)
    expect(icon).toBe('🎯')
  })

  it('falls back to 🖥️ for application type with no icon', () => {
    const { icon } = resolveItemMeta(makeResult({ type: 'application', icon: undefined }), noManifest)
    expect(icon).toBe('🖥️')
  })

  it('falls back to ❯_ for command type with no icon', () => {
    const { icon } = resolveItemMeta(makeResult({ type: 'command', icon: undefined }), noManifest)
    expect(icon).toBe('❯_')
  })

  it('falls back to 🧩 for unknown type with no icon', () => {
    const { icon } = resolveItemMeta(makeResult({ type: undefined, icon: undefined }), noManifest)
    expect(icon).toBe('🧩')
  })

  it('does not override a provided icon even for application type', () => {
    const { icon } = resolveItemMeta(makeResult({ type: 'application', icon: '📦' }), noManifest)
    expect(icon).toBe('📦')
  })
})

// ── TypeLabel resolution ──────────────────────────────────────────────────────

describe('typeLabel resolution', () => {
  it('capitalizes the type string', () => {
    const { typeLabel } = resolveItemMeta(makeResult({ type: 'application' }), noManifest)
    expect(typeLabel).toBe('Application')
  })

  it('uses manifest name for command type when manifest is found', () => {
    const getManifest = (_id: string) => ({ name: 'My Extension' })
    const { typeLabel } = resolveItemMeta(
      makeResult({ type: 'command', extensionId: 'my-ext' }),
      getManifest,
    )
    expect(typeLabel).toBe('My Extension')
  })

  it('falls back to "Command" when manifest is not found', () => {
    const { typeLabel } = resolveItemMeta(
      makeResult({ type: 'command', extensionId: 'unknown-ext' }),
      noManifest,
    )
    expect(typeLabel).toBe('Command')
  })

  it('falls back to "Command" when no extensionId is provided', () => {
    const { typeLabel } = resolveItemMeta(
      makeResult({ type: 'command', extensionId: undefined }),
      noManifest,
    )
    expect(typeLabel).toBe('Command')
  })

  it('does not use manifest name for non-command types', () => {
    const getManifest = (_id: string) => ({ name: 'My Extension' })
    const { typeLabel } = resolveItemMeta(
      makeResult({ type: 'application', extensionId: 'my-ext' }),
      getManifest,
    )
    expect(typeLabel).toBe('Application')
  })

  it('falls back to "Unknown" when type is falsy (defaults to unknown)', () => {
    const { typeLabel } = resolveItemMeta(
      makeResult({ type: undefined as any }),
      noManifest,
    )
    expect(typeLabel).toBe('Unknown')
  })
})

// ── ObjectId resolution ───────────────────────────────────────────────────────

describe('objectId resolution', () => {
  it('returns the result objectId when present', () => {
    const { objectId } = resolveItemMeta(makeResult({ objectId: 'calc-cmd-1' }), noManifest)
    expect(objectId).toBe('calc-cmd-1')
  })

  it('generates a fallback id when objectId is missing', () => {
    const { objectId } = resolveItemMeta(makeResult({ objectId: undefined as any }), noManifest)
    expect(objectId).toMatch(/^fallback_id_/)
  })

  it('generates a fallback id when objectId is an empty string', () => {
    const { objectId } = resolveItemMeta(makeResult({ objectId: '' }), noManifest)
    expect(objectId).toMatch(/^fallback_id_/)
  })
})

// ── buildMappedItems: style & description pass-through ───────────────────────

describe('buildMappedItems preserves calculator fields', () => {
  it('maps style: "large" from SearchResult to MappedSearchItem', () => {
    const calcResult = makeResult({
      objectId: 'ext_calculator_42_0',
      name: '42',
      description: '6 * 7',
      type: 'command',
      score: 1.0,
      icon: '🧮',
      style: 'large',
      action: () => {},
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [calcResult],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '6 * 7',
      selectedIndex: 0,
      onError: vi.fn(),
    })

    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].style).toBe('large')
    expect(mappedItems[0].subtitle).toBe('6 * 7')
    expect(mappedItems[0].icon).toBe('🧮')
  })

  it('maps style: undefined for non-calculator results', () => {
    const appResult = makeResult({
      objectId: 'app_safari',
      name: 'Safari',
      type: 'application',
      score: 0.9,
      path: '/Applications/Safari.app',
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [appResult],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'saf',
      selectedIndex: 0,
      onError: vi.fn(),
    })

    expect(mappedItems[0].style).toBeUndefined()
  })
})

// ── buildMappedItems: command action return value propagation ────────────────

describe('buildMappedItems command action returns result', () => {
  it('propagates the return value from handleCommandAction', async () => {
    vi.mocked(extensionManager.handleCommandAction).mockResolvedValueOnce({ type: 'no-view' })

    const cmdResult = makeResult({
      objectId: 'cmd_quit_quit-asyar',
      name: 'Quit Asyar',
      type: 'command',
      score: 1.0,
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [cmdResult],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'quit',
      selectedIndex: 0,
      onError: vi.fn(),
    })

    const result = await mappedItems[0].action()
    expect(result).toEqual({ type: 'no-view' })
  })

  it('returns undefined when command returns undefined (e.g. cancelled)', async () => {
    vi.mocked(extensionManager.handleCommandAction).mockResolvedValueOnce(undefined)

    const cmdResult = makeResult({
      objectId: 'cmd_quit_quit-asyar',
      name: 'Quit Asyar',
      type: 'command',
      score: 1.0,
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [cmdResult],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'quit',
      selectedIndex: 0,
      onError: vi.fn(),
    })

    const result = await mappedItems[0].action()
    expect(result).toBeUndefined()
  })
})
