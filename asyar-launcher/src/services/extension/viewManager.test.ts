import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get } from 'svelte/store'

// Mock logService before importing viewManager (it calls Tauri log plugin at module level)
vi.mock('../log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { viewManager, activeView, activeViewSearchable } from './viewManager'
import { searchStores } from '../search/stores/search.svelte'
import type { ExtensionManifest } from 'asyar-sdk'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'test-ext',
    name: 'Test Extension',
    version: '1.0.0',
    description: '',
    searchable: false,
    commands: [],
    ...overrides,
  } as ExtensionManifest
}

function makeManifestMap(manifests: ExtensionManifest[]): Map<string, ExtensionManifest> {
  return new Map(manifests.map(m => [m.id, m]))
}

// Default no-op handlers
const noop = async () => {}
const noopSync = () => {}

function initWithManifests(manifests: ExtensionManifest[]) {
  const onActivated = vi.fn()
  const onDeactivated = vi.fn()
  viewManager.init(
    makeManifestMap(manifests),
    noop,   // searchHandler
    noop,   // submitHandler
    onActivated,
    onDeactivated,
  )
  return { onActivated, onDeactivated }
}

beforeEach(() => {
  // Reset viewManager state before each test
  viewManager.init(new Map(), noop, noop, noopSync, noopSync)
  searchStores.query = ''
})

// ── init ─────────────────────────────────────────────────────────────────────

describe('init', () => {
  it('sets activeView to null', () => {
    expect(get(activeView)).toBeNull()
  })

  it('sets activeViewSearchable to false', () => {
    expect(get(activeViewSearchable)).toBe(false)
  })

  it('resets the navigation stack', () => {
    expect(viewManager.getNavigationStackSize()).toBe(0)
  })

  it('isViewActive returns false after init', () => {
    expect(viewManager.isViewActive()).toBe(false)
  })
})

// ── navigateToView ─────────────────────────────────────────────────────────────

describe('navigateToView', () => {
  it('sets activeView to the view path', () => {
    initWithManifests([makeManifest({ id: 'calc' })])
    viewManager.navigateToView('calc/DefaultView')
    expect(get(activeView)).toBe('calc/DefaultView')
  })

  it('sets activeViewSearchable based on manifest.searchable', () => {
    initWithManifests([makeManifest({ id: 'search-ext', searchable: true })])
    viewManager.navigateToView('search-ext/MainView')
    expect(get(activeViewSearchable)).toBe(true)
  })

  it('sets activeViewSearchable to false when manifest.searchable is false', () => {
    initWithManifests([makeManifest({ id: 'calc', searchable: false })])
    viewManager.navigateToView('calc/DefaultView')
    expect(get(activeViewSearchable)).toBe(false)
  })

  it('pushes a state onto the navigation stack', () => {
    initWithManifests([makeManifest({ id: 'calc' })])
    viewManager.navigateToView('calc/DefaultView')
    expect(viewManager.getNavigationStackSize()).toBe(1)
  })

  it('saves the current searchQuery before navigating (on first push)', () => {
    initWithManifests([makeManifest({ id: 'calc' })])
    searchStores.query = 'my previous query'
    viewManager.navigateToView('calc/DefaultView')
    // After navigating, searchQuery is cleared for the new view
    expect(searchStores.query).toBe('')
  })

  it('calls the viewActivated handler with the extension ID and view path', () => {
    const { onActivated } = initWithManifests([makeManifest({ id: 'calc' })])
    viewManager.navigateToView('calc/DefaultView')
    expect(onActivated).toHaveBeenCalledWith('calc', 'calc/DefaultView')
  })

  it('does not navigate when the extension ID is not in the manifest map', () => {
    initWithManifests([])
    viewManager.navigateToView('unknown-ext/DefaultView')
    expect(get(activeView)).toBeNull()
    expect(viewManager.getNavigationStackSize()).toBe(0)
  })

  it('supports stacking multiple views', () => {
    initWithManifests([
      makeManifest({ id: 'ext-a' }),
      makeManifest({ id: 'ext-b' }),
    ])
    viewManager.navigateToView('ext-a/ViewOne')
    viewManager.navigateToView('ext-b/ViewTwo')
    expect(viewManager.getNavigationStackSize()).toBe(2)
    expect(get(activeView)).toBe('ext-b/ViewTwo')
  })
})

// ── goBack ─────────────────────────────────────────────────────────────────────

describe('goBack', () => {
  it('sets activeView to null when returning from the only view', () => {
    initWithManifests([makeManifest({ id: 'calc' })])
    viewManager.navigateToView('calc/DefaultView')
    viewManager.goBack()
    expect(get(activeView)).toBeNull()
  })

  it('sets activeViewSearchable to false when returning to main', () => {
    initWithManifests([makeManifest({ id: 'calc', searchable: true })])
    viewManager.navigateToView('calc/DefaultView')
    viewManager.goBack()
    expect(get(activeViewSearchable)).toBe(false)
  })

  it('restores the saved main search query on return to main', () => {
    initWithManifests([makeManifest({ id: 'calc' })])
    searchStores.query = 'original query'
    viewManager.navigateToView('calc/DefaultView')
    viewManager.goBack()
    expect(searchStores.query).toBe('original query')
  })

  it('empties the navigation stack after going back from the last view', () => {
    initWithManifests([makeManifest({ id: 'calc' })])
    viewManager.navigateToView('calc/DefaultView')
    viewManager.goBack()
    expect(viewManager.getNavigationStackSize()).toBe(0)
  })

  it('calls the viewDeactivated handler when returning to main', () => {
    const { onDeactivated } = initWithManifests([makeManifest({ id: 'calc' })])
    viewManager.navigateToView('calc/DefaultView')
    viewManager.goBack()
    expect(onDeactivated).toHaveBeenCalledWith('calc', 'calc/DefaultView')
  })

  it('returns to the previous stacked view (not main) when stack has multiple entries', () => {
    initWithManifests([
      makeManifest({ id: 'ext-a' }),
      makeManifest({ id: 'ext-b' }),
    ])
    viewManager.navigateToView('ext-a/ViewOne')
    viewManager.navigateToView('ext-b/ViewTwo')
    viewManager.goBack()
    expect(get(activeView)).toBe('ext-a/ViewOne')
    expect(viewManager.getNavigationStackSize()).toBe(1)
  })

  it('is safe to call when the stack is empty', () => {
    expect(() => viewManager.goBack()).not.toThrow()
  })

  it('isViewActive returns false after goBack to main', () => {
    initWithManifests([makeManifest({ id: 'calc' })])
    viewManager.navigateToView('calc/DefaultView')
    viewManager.goBack()
    expect(viewManager.isViewActive()).toBe(false)
  })
})

// ── handleViewSearch ──────────────────────────────────────────────────────────

describe('handleViewSearch', () => {
  it('calls the searchHandler with the query when a view is active', async () => {
    const searchHandler = vi.fn().mockResolvedValue(undefined)
    const manifest = makeManifest({ id: 'calc' })
    viewManager.init(makeManifestMap([manifest]), searchHandler, noop, noopSync, noopSync)
    viewManager.navigateToView('calc/DefaultView')
    await viewManager.handleViewSearch('test query')
    expect(searchHandler).toHaveBeenCalledWith('test query')
  })

  it('does not call the searchHandler when no view is active', async () => {
    const searchHandler = vi.fn().mockResolvedValue(undefined)
    viewManager.init(new Map(), searchHandler, noop, noopSync, noopSync)
    await viewManager.handleViewSearch('test query')
    expect(searchHandler).not.toHaveBeenCalled()
  })
})

// ── handleViewSubmit ──────────────────────────────────────────────────────────

describe('handleViewSubmit', () => {
  it('calls the submitHandler with the query when a view is active', async () => {
    const submitHandler = vi.fn().mockResolvedValue(undefined)
    const manifest = makeManifest({ id: 'calc' })
    viewManager.init(makeManifestMap([manifest]), noop, submitHandler, noopSync, noopSync)
    viewManager.navigateToView('calc/DefaultView')
    await viewManager.handleViewSubmit('submit me')
    expect(submitHandler).toHaveBeenCalledWith('submit me')
  })

  it('does not call the submitHandler when no view is active', async () => {
    const submitHandler = vi.fn().mockResolvedValue(undefined)
    viewManager.init(new Map(), noop, submitHandler, noopSync, noopSync)
    await viewManager.handleViewSubmit('submit me')
    expect(submitHandler).not.toHaveBeenCalled()
  })
})

// ── getActiveView / isViewActive ──────────────────────────────────────────────

describe('getActiveView / isViewActive', () => {
  it('getActiveView returns null when no view is active', () => {
    expect(viewManager.getActiveView()).toBeNull()
  })

  it('getActiveView returns the current view path', () => {
    initWithManifests([makeManifest({ id: 'calc' })])
    viewManager.navigateToView('calc/DefaultView')
    expect(viewManager.getActiveView()).toBe('calc/DefaultView')
  })

  it('isViewActive returns true when a view is active', () => {
    initWithManifests([makeManifest({ id: 'calc' })])
    viewManager.navigateToView('calc/DefaultView')
    expect(viewManager.isViewActive()).toBe(true)
  })
})
