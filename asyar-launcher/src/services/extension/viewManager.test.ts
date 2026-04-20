import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock logService before importing viewManager (it calls Tauri log plugin at module level)
vi.mock('../log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./extensionIframeManager.svelte', () => ({
  extensionIframeManager: {
    sendViewSearchToExtension: vi.fn(),
    handleExtensionSubmit: vi.fn(),
  },
}))

import { viewManager } from './viewManager.svelte'
import { searchStores } from '../search/stores/search.svelte'
import { extensionIframeManager } from './extensionIframeManager.svelte'
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

function initWithManifests(manifests: ExtensionManifest[]) {
  viewManager.init(makeManifestMap(manifests))
}

beforeEach(() => {
  // Reset viewManager state before each test
  viewManager.init(new Map())
  searchStores.query = ''
})

// ── init ─────────────────────────────────────────────────────────────────────

describe('init', () => {
  it('sets activeView to null', () => {
    expect(viewManager.activeView).toBeNull()
  })

  it('sets activeViewSearchable to false', () => {
    expect(viewManager.activeViewSearchable).toBe(false)
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
    expect(viewManager.activeView).toBe('calc/DefaultView')
  })

  it('sets activeViewSearchable based on manifest.searchable', () => {
    initWithManifests([makeManifest({ id: 'search-ext', searchable: true })])
    viewManager.navigateToView('search-ext/MainView')
    expect(viewManager.activeViewSearchable).toBe(true)
  })

  it('sets activeViewSearchable to false when manifest.searchable is false', () => {
    initWithManifests([makeManifest({ id: 'calc', searchable: false })])
    viewManager.navigateToView('calc/DefaultView')
    expect(viewManager.activeViewSearchable).toBe(false)
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

  it('does not navigate when the extension ID is not in the manifest map', () => {
    initWithManifests([])
    viewManager.navigateToView('unknown-ext/DefaultView')
    expect(viewManager.activeView).toBeNull()
    expect(viewManager.getNavigationStackSize()).toBe(0)
  })

  it('stacks multiple views within the same extension (drill-down)', () => {
    initWithManifests([makeManifest({ id: 'ext-a' })])
    viewManager.navigateToView('ext-a/ViewOne')
    viewManager.navigateToView('ext-a/ViewTwo')
    expect(viewManager.getNavigationStackSize()).toBe(2)
    expect(viewManager.activeView).toBe('ext-a/ViewTwo')
  })

  it('cross-extension navigation outside a replacement scope pushes', () => {
    // Mid-workflow jumps (e.g. clipboard's "Save as Snippet") let the user
    // resume what they were doing when they press escape.
    initWithManifests([
      makeManifest({ id: 'ext-a' }),
      makeManifest({ id: 'ext-b' }),
    ])
    viewManager.navigateToView('ext-a/ViewOne')
    viewManager.navigateToView('ext-b/ViewTwo')
    expect(viewManager.getNavigationStackSize()).toBe(2)
    viewManager.goBack()
    expect(viewManager.activeView).toBe('ext-a/ViewOne')
  })
})

// ── goBack ─────────────────────────────────────────────────────────────────────

describe('goBack', () => {
  it('sets activeView to null when returning from the only view', () => {
    initWithManifests([makeManifest({ id: 'calc' })])
    viewManager.navigateToView('calc/DefaultView')
    viewManager.goBack()
    expect(viewManager.activeView).toBeNull()
  })

  it('sets activeViewSearchable to false when returning to main', () => {
    initWithManifests([makeManifest({ id: 'calc', searchable: true })])
    viewManager.navigateToView('calc/DefaultView')
    viewManager.goBack()
    expect(viewManager.activeViewSearchable).toBe(false)
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

  it('returns to the previous stacked view (not main) when drilling down within an extension', () => {
    initWithManifests([makeManifest({ id: 'ext-a' })])
    viewManager.navigateToView('ext-a/ViewOne')
    viewManager.navigateToView('ext-a/ViewTwo')
    viewManager.goBack()
    expect(viewManager.activeView).toBe('ext-a/ViewOne')
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

// ── withReplacementSemantics ─────────────────────────────────────────────────

describe('withReplacementSemantics (hotkey entry point)', () => {
  it('replaces the current view with no intermediate null on activeView', async () => {
    initWithManifests([
      makeManifest({ id: 'ext-a' }),
      makeManifest({ id: 'ext-b' }),
    ])
    viewManager.navigateToView('ext-a/ViewOne')

    const observed: (string | null)[] = []
    await viewManager.withReplacementSemantics(async () => {
      observed.push(viewManager.activeView)
      await Promise.resolve()
      observed.push(viewManager.activeView)
      viewManager.navigateToView('ext-b/ViewTwo')
      observed.push(viewManager.activeView)
    })

    expect(observed).toEqual(['ext-a/ViewOne', 'ext-a/ViewOne', 'ext-b/ViewTwo'])
    expect(viewManager.activeView).toBe('ext-b/ViewTwo')
  })

  it('escape from the hotkey target goes to main, not the displaced view', async () => {
    initWithManifests([
      makeManifest({ id: 'ext-a' }),
      makeManifest({ id: 'ext-b' }),
    ])
    viewManager.navigateToView('ext-a/ViewOne')
    await viewManager.withReplacementSemantics(async () => {
      viewManager.navigateToView('ext-b/ViewTwo')
    })
    expect(viewManager.getNavigationStackSize()).toBe(1)
    viewManager.goBack()
    expect(viewManager.activeView).toBeNull()
  })

  it('fires viewDeactivated for the displaced view', async () => {
    const deactivatedA = vi.fn()
    const activatedB = vi.fn()
    const moduleA = { viewDeactivated: deactivatedA }
    const moduleB = { viewActivated: activatedB }
    initWithManifests([
      makeManifest({ id: 'ext-a' }),
      makeManifest({ id: 'ext-b' }),
    ])
    viewManager.setModuleResolver({
      getModule: (id: string) => (id === 'ext-a' ? moduleA : id === 'ext-b' ? moduleB : undefined),
      resolveInstance: (m: unknown) => m as any,
    })
    viewManager.navigateToView('ext-a/ViewOne')

    await viewManager.withReplacementSemantics(async () => {
      viewManager.navigateToView('ext-b/ViewTwo')
    })
    await Promise.resolve()

    expect(deactivatedA).toHaveBeenCalledWith('ext-a/ViewOne')
    expect(activatedB).toHaveBeenCalledWith('ext-b/ViewTwo')
  })

  it('only the first navigateToView replaces; subsequent ones in the same scope push', async () => {
    initWithManifests([
      makeManifest({ id: 'ext-a' }),
      makeManifest({ id: 'ext-b' }),
      makeManifest({ id: 'ext-c' }),
    ])
    viewManager.navigateToView('ext-a/ViewOne')

    await viewManager.withReplacementSemantics(async () => {
      viewManager.navigateToView('ext-b/ViewTwo')  // replaces ext-a
      viewManager.navigateToView('ext-c/ViewThree') // pushes onto ext-b
    })

    expect(viewManager.getNavigationStackSize()).toBe(2)
    expect(viewManager.activeView).toBe('ext-c/ViewThree')
    viewManager.goBack()
    expect(viewManager.activeView).toBe('ext-b/ViewTwo')
  })

  it('clears the flag on scope exit when the callback never navigates', async () => {
    initWithManifests([
      makeManifest({ id: 'ext-a' }),
      makeManifest({ id: 'ext-b' }),
    ])
    viewManager.navigateToView('ext-a/ViewOne')

    await viewManager.withReplacementSemantics(async () => {
      // Side-effect-only command; no navigateToView.
    })

    viewManager.navigateToView('ext-b/ViewTwo')
    expect(viewManager.getNavigationStackSize()).toBe(2)
  })

  it('clears the flag even when the callback throws', async () => {
    initWithManifests([
      makeManifest({ id: 'ext-a' }),
      makeManifest({ id: 'ext-b' }),
    ])
    viewManager.navigateToView('ext-a/ViewOne')

    await expect(
      viewManager.withReplacementSemantics(async () => {
        throw new Error('command failed')
      })
    ).rejects.toThrow('command failed')

    viewManager.navigateToView('ext-b/ViewTwo')
    expect(viewManager.getNavigationStackSize()).toBe(2)
  })

  it('behaves like a normal push when starting from no view', async () => {
    initWithManifests([makeManifest({ id: 'ext-a' })])
    searchStores.query = 'typed-before-hotkey'

    await viewManager.withReplacementSemantics(async () => {
      viewManager.navigateToView('ext-a/ViewOne')
    })

    expect(viewManager.activeView).toBe('ext-a/ViewOne')
    expect(viewManager.getNavigationStackSize()).toBe(1)
    viewManager.goBack()
    expect(searchStores.query).toBe('typed-before-hotkey')
  })

  it('discards the displaced extension\'s captured query on escape-to-main', async () => {
    initWithManifests([
      makeManifest({ id: 'ext-a' }),
      makeManifest({ id: 'ext-b' }),
    ])
    searchStores.query = 'query-captured-when-ext-a-was-entered'
    viewManager.navigateToView('ext-a/ViewOne')
    searchStores.query = '' // shortcut service clears before firing the command

    await viewManager.withReplacementSemantics(async () => {
      viewManager.navigateToView('ext-b/ViewTwo')
    })
    viewManager.goBack()

    expect(viewManager.activeView).toBeNull()
    expect(searchStores.query).toBe('')
  })
})

// ── handleViewSearch ──────────────────────────────────────────────────────────

describe('handleViewSearch', () => {
  it('calls onViewSearch via module resolver when a view is active', async () => {
    const searchMock = vi.fn().mockResolvedValue(undefined)
    const module = { onViewSearch: searchMock }
    const manifest = makeManifest({ id: 'calc' })
    viewManager.init(makeManifestMap([manifest]))
    viewManager.setModuleResolver({
      getModule: (id: string) => id === 'calc' ? module : undefined,
      resolveInstance: (m: unknown) => m as any,
    })
    viewManager.navigateToView('calc/DefaultView')
    await viewManager.handleViewSearch('test query')
    expect(searchMock).toHaveBeenCalledWith('test query')
  })

  it('does not call onViewSearch when no view is active', async () => {
    const searchMock = vi.fn().mockResolvedValue(undefined)
    const module = { onViewSearch: searchMock }
    viewManager.init(new Map())
    viewManager.setModuleResolver({
      getModule: (id: string) => id === 'calc' ? module : undefined,
      resolveInstance: (m: unknown) => m as any,
    })
    await viewManager.handleViewSearch('test query')
    expect(searchMock).not.toHaveBeenCalled()
  })
})

// ── handleViewSubmit ──────────────────────────────────────────────────────────

describe('handleViewSubmit', () => {
  it('calls onViewSubmit via module resolver when a view is active', async () => {
    const submitMock = vi.fn().mockResolvedValue(undefined)
    const module = { onViewSubmit: submitMock }
    const manifest = makeManifest({ id: 'calc' })
    viewManager.init(makeManifestMap([manifest]))
    viewManager.setModuleResolver({
      getModule: (id: string) => id === 'calc' ? module : undefined,
      resolveInstance: (m: unknown) => m as any,
    })
    viewManager.navigateToView('calc/DefaultView')
    await viewManager.handleViewSubmit('submit me')
    expect(submitMock).toHaveBeenCalledWith('submit me')
  })

  it('does not call onViewSubmit when no view is active', async () => {
    const submitMock = vi.fn().mockResolvedValue(undefined)
    const module = { onViewSubmit: submitMock }
    viewManager.init(new Map())
    viewManager.setModuleResolver({
      getModule: (id: string) => id === 'calc' ? module : undefined,
      resolveInstance: (m: unknown) => m as any,
    })
    await viewManager.handleViewSubmit('submit me')
    expect(submitMock).not.toHaveBeenCalled()
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

// ── Module resolver forwarding ──────────────────────────────────────────────

describe('module resolver forwarding', () => {
  const tier1Module = {
    onViewSearch: vi.fn().mockResolvedValue(undefined),
    onViewSubmit: vi.fn().mockResolvedValue(undefined),
    viewActivated: vi.fn(),
    viewDeactivated: vi.fn(),
  }

  function initWithResolver(manifests: ExtensionManifest[], modules: Map<string, unknown>) {
    viewManager.init(makeManifestMap(manifests))
    viewManager.setModuleResolver({
      getModule: (id: string) => modules.get(id),
      resolveInstance: (module: unknown) => module as any,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleViewSearch with module resolver', () => {
    it('calls onViewSearch directly for Tier 1 extensions', async () => {
      const modules = new Map([['calc', tier1Module]])
      initWithResolver([makeManifest({ id: 'calc' })], modules)
      viewManager.navigateToView('calc/DefaultView')

      await viewManager.handleViewSearch('test query')

      expect(tier1Module.onViewSearch).toHaveBeenCalledWith('test query')
      expect(extensionIframeManager.sendViewSearchToExtension).not.toHaveBeenCalled()
    })

    it('forwards search to iframe for Tier 2 extensions (no module)', async () => {
      const modules = new Map<string, unknown>() // no module for tier2-ext
      initWithResolver([makeManifest({ id: 'tier2-ext' })], modules)
      viewManager.navigateToView('tier2-ext/DefaultView')

      await viewManager.handleViewSearch('tauri commands')

      expect(extensionIframeManager.sendViewSearchToExtension).toHaveBeenCalledWith('tier2-ext', 'tauri commands')
    })

    it('does nothing when no active view', async () => {
      const modules = new Map([['calc', tier1Module]])
      initWithResolver([makeManifest({ id: 'calc' })], modules)
      // Do NOT navigate — no active view

      await viewManager.handleViewSearch('query')

      expect(tier1Module.onViewSearch).not.toHaveBeenCalled()
      expect(extensionIframeManager.sendViewSearchToExtension).not.toHaveBeenCalled()
    })
  })

  describe('handleViewSubmit with module resolver', () => {
    it('calls onViewSubmit directly for Tier 1 extensions', async () => {
      const modules = new Map([['calc', tier1Module]])
      initWithResolver([makeManifest({ id: 'calc' })], modules)
      viewManager.navigateToView('calc/DefaultView')

      await viewManager.handleViewSubmit('submit value')

      expect(tier1Module.onViewSubmit).toHaveBeenCalledWith('submit value')
      expect(extensionIframeManager.handleExtensionSubmit).not.toHaveBeenCalled()
    })

    it('forwards submit to iframe for Tier 2 extensions (no module)', async () => {
      const modules = new Map<string, unknown>()
      initWithResolver([makeManifest({ id: 'tier2-ext' })], modules)
      viewManager.navigateToView('tier2-ext/DefaultView')

      await viewManager.handleViewSubmit('submit value')

      expect(extensionIframeManager.handleExtensionSubmit).toHaveBeenCalledWith('tier2-ext', 'submit value')
    })

    it('falls through to iframe for Tier 1 module without onViewSubmit', async () => {
      const moduleWithoutSubmit = { viewActivated: vi.fn() }
      const modules = new Map<string, unknown>([['calc', moduleWithoutSubmit]])
      initWithResolver([makeManifest({ id: 'calc' })], modules)
      viewManager.navigateToView('calc/DefaultView')

      await viewManager.handleViewSubmit('test')

      expect(extensionIframeManager.handleExtensionSubmit).toHaveBeenCalledWith('calc', 'test')
    })
  })

  describe('navigateToView calls viewActivated via resolver', () => {
    it('calls viewActivated on Tier 1 extension module', () => {
      const modules = new Map([['calc', tier1Module]])
      initWithResolver([makeManifest({ id: 'calc' })], modules)

      viewManager.navigateToView('calc/DefaultView')

      expect(tier1Module.viewActivated).toHaveBeenCalledWith('calc/DefaultView')
    })
  })

  describe('goBack calls viewDeactivated via resolver', () => {
    it('calls viewDeactivated when returning to main', () => {
      const modules = new Map([['calc', tier1Module]])
      initWithResolver([makeManifest({ id: 'calc' })], modules)
      viewManager.navigateToView('calc/DefaultView')

      viewManager.goBack()

      expect(tier1Module.viewDeactivated).toHaveBeenCalledWith('calc/DefaultView')
    })

    it('calls viewActivated on previous view when popping within an extension', () => {
      const tier1ModuleA = { viewActivated: vi.fn(), viewDeactivated: vi.fn() }
      const modules = new Map<string, unknown>([['ext-a', tier1ModuleA]])
      initWithResolver([makeManifest({ id: 'ext-a' })], modules)
      viewManager.navigateToView('ext-a/ViewOne')
      viewManager.navigateToView('ext-a/ViewTwo')
      vi.clearAllMocks()

      viewManager.goBack()

      expect(tier1ModuleA.viewActivated).toHaveBeenCalledWith('ext-a/ViewOne')
    })
  })
})

