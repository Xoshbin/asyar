/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExtensionLoader } from './ExtensionLoader'
import { ActionContext } from 'asyar-sdk/contracts'

// ---------- hoisted mocks ----------

const mockSearchOrchestrator = vi.hoisted(() => ({ items: [] as any[] }))
vi.mock('../search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: mockSearchOrchestrator,
}))

const mockSearchStores = vi.hoisted(() => ({ selectedIndex: -1 }))
vi.mock('../search/stores/search.svelte', () => ({
  searchStores: mockSearchStores,
}))

const mockSettingsGetSettings = vi.hoisted(() =>
  vi.fn().mockReturnValue({ search: { enableExtensionSearch: false, allowExtensionActions: true } })
)
vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: mockSettingsGetSettings,
    isInitialized: vi.fn().mockReturnValue(true),
    init: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => {}),
    isExtensionEnabled: vi.fn().mockReturnValue(true),
    updateSettings: vi.fn(),
    updateExtensionState: vi.fn(),
    removeExtensionState: vi.fn(),
  },
}))

// Capture calls to registerAction so we can inspect visible() callbacks
const registeredActions: any[] = []
vi.mock('../action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn((action: any) => { registeredActions.push(action) }),
    getAllActions: vi.fn().mockReturnValue([]),
    unregisterAction: vi.fn(),
    clearActionsForExtension: vi.fn(),
    setContext: vi.fn(),
    setActionExecutor: vi.fn(),
    refreshFiltered: vi.fn(),
    filteredActions: [],
  },
}))

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../extensionLoaderService', () => ({
  extensionLoaderService: {
    loadAllExtensions: vi.fn().mockResolvedValue(new Map()),
    loadSingleExtension: vi.fn().mockResolvedValue(null),
  },
}))
vi.mock('../performance/performanceService.svelte', () => ({
  performanceService: {
    init: vi.fn(),
    startTiming: vi.fn(),
    stopTiming: vi.fn().mockReturnValue({ duration: 0 }),
    trackExtensionLoadStart: vi.fn(),
    trackExtensionLoadEnd: vi.fn(),
  },
}))
vi.mock('../envService', () => ({ envService: { isDev: vi.fn().mockReturnValue(false) } }))
vi.mock('../../lib/ipc/commands', () => ({
  syncSearchIndex: vi.fn().mockResolvedValue(undefined),
  syncCommandIndex: vi.fn().mockResolvedValue(undefined),
}))
const mockCommandHandlers = vi.hoisted(() => new Map<string, any>())
vi.mock('./commandService.svelte', () => ({
  commandService: {
    setShortCommandId: vi.fn(),
    registerCommandObjectId: vi.fn(),
    registerCommand: vi.fn((id: string, handler: any) => {
      mockCommandHandlers.set(id, handler)
    }),
    getLiveSubtitle: vi.fn(),
    liveSubtitles: {},
    __handlers: mockCommandHandlers,
  },
}))

vi.mock('./extensionDispatcher.svelte', () => ({ dispatch: vi.fn() }))
vi.mock('./extensionIframeManager.svelte', () => ({
  extensionIframeManager: { getIframeRef: vi.fn() },
}))
vi.mock('./extensionPreferencesService.svelte', () => ({
  extensionPreferencesService: {
    preLoadPreferences: vi.fn().mockResolvedValue(undefined),
    getCurrentPreferences: vi.fn().mockReturnValue({}),
  },
}))

// ---------- helpers ----------

function makeManifest(extensionId: string, actions: any[] = [], commands: any[] = []) {
  return {
    id: extensionId,
    name: extensionId,
    version: '1.0.0',
    description: '',
    type: 'view' as const,
    permissions: [],
    actions,
    commands,
  }
}

function makeCommand(cmdId: string, actions: any[] = []) {
  return { id: cmdId, name: cmdId, description: '', trigger: cmdId, actions }
}

function makeLoader(loadedCommands: { cmd: any; manifest: any; isBuiltIn: boolean }[]) {
  const loader = new ExtensionLoader({} as any, {} as any)
  ;(loader as any).allLoadedCommands = loadedCommands
  return loader
}

// ---------- tests ----------

describe('ExtensionLoader.registerManifestActions', () => {
  beforeEach(() => {
    registeredActions.length = 0
    vi.clearAllMocks()
    // Reset getSettings to default (allowExtensionActions = true)
    mockSettingsGetSettings.mockReturnValue({
      search: { enableExtensionSearch: false, allowExtensionActions: true },
    })
  })

  describe('when allowExtensionActions = true', () => {
    it('registers extension-level actions with a visible() that returns true when the correct extension command is selected', () => {
      const manifest = makeManifest('test-ext', [{ id: 'open', title: 'Open', category: 'Test' }])
      const cmd = makeCommand('do-thing')
      const loader = makeLoader([{ cmd, manifest, isBuiltIn: true }])

      loader.registerManifestActions()

      const action = registeredActions.find(a => a.id === 'act_test-ext_open')
      expect(action).toBeDefined()
      expect(action.extensionId).toBe('test-ext')
      expect(action.context).toBe(ActionContext.CORE)

      // Simulate item selected = command from this extension
      mockSearchStores.selectedIndex = 0
      mockSearchOrchestrator.items = [{ type: 'command', extensionId: 'test-ext', objectId: 'cmd_test-ext_do-thing' }]
      expect(action.visible()).toBe(true)
    })

    it('extension-level visible() returns false when a different extension is selected', () => {
      const manifest = makeManifest('test-ext', [{ id: 'open', title: 'Open' }])
      const loader = makeLoader([{ cmd: makeCommand('do-thing'), manifest, isBuiltIn: true }])

      loader.registerManifestActions()

      const action = registeredActions.find(a => a.id === 'act_test-ext_open')
      mockSearchStores.selectedIndex = 0
      mockSearchOrchestrator.items = [{ type: 'command', extensionId: 'other-ext', objectId: 'cmd_other-ext_cmd' }]
      expect(action.visible()).toBe(false)
    })

    it('registers command-level actions with a visible() that returns true only for that command', () => {
      const cmdActions = [{ id: 'copy', title: 'Copy Result' }]
      const manifest = makeManifest('test-ext', [], [])
      const cmd = makeCommand('search-cmd', cmdActions)
      const loader = makeLoader([{ cmd, manifest, isBuiltIn: true }])

      loader.registerManifestActions()

      const action = registeredActions.find(a => a.id === 'act_test-ext_copy')
      expect(action).toBeDefined()

      // Exact command selected
      mockSearchStores.selectedIndex = 0
      mockSearchOrchestrator.items = [{ objectId: 'cmd_test-ext_search-cmd' }]
      expect(action.visible()).toBe(true)

      // Different command selected
      mockSearchOrchestrator.items = [{ objectId: 'cmd_test-ext_other-cmd' }]
      expect(action.visible()).toBe(false)
    })

    it('registers extension-level actions once per extension even with multiple commands', () => {
      const manifest = makeManifest('multi-ext', [{ id: 'settings', title: 'Settings' }])
      const cmd1 = makeCommand('cmd-a')
      const cmd2 = makeCommand('cmd-b')
      const loader = makeLoader([
        { cmd: cmd1, manifest, isBuiltIn: true },
        { cmd: cmd2, manifest, isBuiltIn: true },
      ])

      loader.registerManifestActions()

      const settingsActions = registeredActions.filter(a => a.id === 'act_multi-ext_settings')
      expect(settingsActions).toHaveLength(1)
    })
  })

  describe('when allowExtensionActions = false', () => {
    beforeEach(() => {
      mockSettingsGetSettings.mockReturnValue({
        search: { enableExtensionSearch: false, allowExtensionActions: false },
      })
    })

    it('extension-level action visible() returns false even when the correct command is selected', () => {
      const manifest = makeManifest('test-ext', [{ id: 'open', title: 'Open' }])
      const loader = makeLoader([{ cmd: makeCommand('do-thing'), manifest, isBuiltIn: true }])

      loader.registerManifestActions()

      const action = registeredActions.find(a => a.id === 'act_test-ext_open')
      expect(action).toBeDefined()

      mockSearchStores.selectedIndex = 0
      mockSearchOrchestrator.items = [{ type: 'command', extensionId: 'test-ext', objectId: 'cmd_test-ext_do-thing' }]
      // Setting is OFF → must return false regardless of selection
      expect(action.visible()).toBe(false)
    })

    it('command-level action visible() returns false even when the exact command is selected', () => {
      const cmdActions = [{ id: 'copy', title: 'Copy Result' }]
      const loader = makeLoader([
        { cmd: makeCommand('search-cmd', cmdActions), manifest: makeManifest('test-ext'), isBuiltIn: true },
      ])

      loader.registerManifestActions()

      const action = registeredActions.find(a => a.id === 'act_test-ext_copy')
      expect(action).toBeDefined()

      mockSearchStores.selectedIndex = 0
      mockSearchOrchestrator.items = [{ objectId: 'cmd_test-ext_search-cmd' }]
      // Setting is OFF → must return false
      expect(action.visible()).toBe(false)
    })
  })

  describe('when allowExtensionActions is undefined (older settings.dat)', () => {
    beforeEach(() => {
      // Simulate missing key (undefined) — should be treated as ON
      mockSettingsGetSettings.mockReturnValue({
        search: { enableExtensionSearch: false },
      })
    })

    it('extension-level action visible() returns true (undefined treated as ON via !== false)', () => {
      const manifest = makeManifest('test-ext', [{ id: 'open', title: 'Open' }])
      const loader = makeLoader([{ cmd: makeCommand('do-thing'), manifest, isBuiltIn: true }])

      loader.registerManifestActions()

      const action = registeredActions.find(a => a.id === 'act_test-ext_open')
      mockSearchStores.selectedIndex = 0
      mockSearchOrchestrator.items = [{ type: 'command', extensionId: 'test-ext', objectId: 'cmd_test-ext_do-thing' }]
      expect(action.visible()).toBe(true)
    })
  })
})

describe('ExtensionLoader Tier 2 no-view handler routes through dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCommandHandlers.clear()
  })

  it('execute() calls dispatch with source=search and the correct payload', async () => {
    const { dispatch } = await import('./extensionDispatcher.svelte')
    const loader = new ExtensionLoader(
      { registerManifest: vi.fn() } as any,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    )
    ;(loader as any).allLoadedCommands = [{
      cmd: { id: 'run', name: 'Run', mode: 'background' },
      manifest: { id: 'ext.a', commands: [] },
      isBuiltIn: false,
    }]
    ;(loader as any).extensionModulesById = new Map()

    loader.registerCommandHandlersFromManifests(vi.fn())
    const handler = mockCommandHandlers.get('cmd_ext.a_run')
    expect(handler).toBeDefined()
    await handler.execute({ foo: 1 })

    expect(dispatch).toHaveBeenCalledWith({
      extensionId: 'ext.a',
      kind: 'command',
      payload: { commandId: 'run', args: { foo: 1 } },
      source: 'search',
      commandMode: 'background',
    })
  })
})
