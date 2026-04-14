// Regression guard for the module-load cycle that caused a TDZ white-screen
// crash in the Settings webview.  The cycle was:
//   Settings +page.svelte → components barrel → ActionListPopup →
//   actionService → searchOrchestrator → appInitializer →
//   extensionManager → actionService  (TDZ)
// The fix: extensionManager must NOT eagerly import actionService at module
// body level; the wiring must be deferred to init() via a dynamic import.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Test 1 – Static import-graph check
// Asserts that extensionManager.svelte.ts does NOT contain an eager
// (non-type) import of actionService.  This is the exact pattern that
// triggered the TDZ crash and must never be re-introduced.
// ---------------------------------------------------------------------------

describe('extensionManager – no eager actionService import (cycle guard)', () => {
  it('does not contain an eager import of actionService at module body level', () => {
    const filePath = resolve(
      __dirname,
      'extensionManager.svelte.ts'
    )
    const source = readFileSync(filePath, 'utf-8')

    // Match a real (non-type-only) import that pulls in actionService by name.
    // Type-only imports (`import type { … }`) are safe and are allowed.
    const eagerImportPattern =
      /^import\s+\{[^}]*\bactionService\b[^}]*\}\s+from\s+['"]\.\.\/action\/actionService/m

    expect(source).not.toMatch(eagerImportPattern)
  })
})

// ---------------------------------------------------------------------------
// Test 2 – Functional smoke test (settings-window entry order)
// Dynamically imports actionService first, then extensionManager (the order
// the Settings webview's module graph enters these modules), and asserts
// both resolve without throwing.  vi.resetModules() ensures no cached
// module state bleeds between tests.
// ---------------------------------------------------------------------------

// --- Mocks required so the modules can be loaded in Node / Vitest env ---

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), custom: vi.fn() }
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ resourceDir: vi.fn(), appDataDir: vi.fn(), join: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(), readDir: vi.fn(), remove: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('asyar-sdk', () => ({
  ExtensionBridge: {
    getInstance: vi.fn().mockReturnValue({
      registerManifest: vi.fn(),
      registerExtensionImplementation: vi.fn(),
      initializeExtensions: vi.fn().mockResolvedValue(true),
      activateExtensions: vi.fn().mockResolvedValue(true),
      deactivateExtensions: vi.fn().mockResolvedValue(true),
    })
  },
  ActionContext: { CORE: 'CORE' },
}))
vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn() }))
vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    isInitialized: vi.fn().mockReturnValue(true),
    init: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => {}),
    isExtensionEnabled: vi.fn().mockReturnValue(true),
    getSettings: vi.fn().mockReturnValue({ search: { enableExtensionSearch: false } }),
    updateSettings: vi.fn(),
    updateExtensionState: vi.fn(),
    removeExtensionState: vi.fn(),
  }
}))
vi.mock('../performance/performanceService.svelte', () => ({
  performanceService: {
    init: vi.fn(),
    startTiming: vi.fn(),
    stopTiming: vi.fn().mockReturnValue({ duration: 0 }),
  }
}))
vi.mock('../extensionLoaderService', () => ({
  extensionLoaderService: {
    loadAllExtensions: vi.fn().mockResolvedValue(new Map()),
    loadSingleExtension: vi.fn().mockResolvedValue(null),
  }
}))
vi.mock('./extensionDiscovery', () => ({
  discoverExtensions: vi.fn().mockResolvedValue([]),
  isBuiltInFeature: vi.fn().mockReturnValue(false),
}))
vi.mock('./commandService.svelte', () => ({
  commandService: {
    registerCommand: vi.fn(),
    executeCommand: vi.fn().mockResolvedValue(undefined),
    clearCommandsForExtension: vi.fn(),
    getCommands: vi.fn().mockReturnValue([]),
    commands: new Map(),
  }
}))
vi.mock('./viewManager.svelte', () => ({
  viewManager: {
    init: vi.fn(),
    navigateToView: vi.fn(),
    goBack: vi.fn(),
    getActiveView: vi.fn().mockReturnValue(null),
    isViewActive: vi.fn().mockReturnValue(false),
    getNavigationStackSize: vi.fn().mockReturnValue(0),
    handleViewSearch: vi.fn().mockResolvedValue(undefined),
    handleViewSubmit: vi.fn().mockResolvedValue(undefined),
    activeView: null,
    activeViewSearchable: false,
    activeViewPrimaryActionLabel: null,
    activeViewSubtitle: null,
  }
}))
vi.mock('../search/SearchService', () => ({
  searchService: {
    getIndexedObjectIds: vi.fn().mockResolvedValue(new Set()),
    batchIndexItems: vi.fn().mockResolvedValue(undefined),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    saveIndex: vi.fn().mockResolvedValue(undefined),
  }
}))
vi.mock('../search/topItemsCache', () => ({ invalidateTopItemsCache: vi.fn() }))
vi.mock('../search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: {
    init: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    getResults: vi.fn().mockReturnValue([]),
    items: [],
  }
}))
vi.mock('../search/stores/search.svelte', () => ({
  searchStores: {
    query: '',
    results: [],
    isLoading: false,
  }
}))
vi.mock('../statusBar/statusBarService.svelte', () => ({
  statusBarService: { clearItemsForExtension: vi.fn(), addItem: vi.fn(), removeItem: vi.fn() }
}))
vi.mock('../envService', () => ({ envService: { isTauri: false } }))
vi.mock('./extensionIframeManager.svelte', () => ({
  extensionIframeManager: {
    init: vi.fn(),
    hasInputFocus: false,
    sendViewSearchToExtension: vi.fn(),
    handleExtensionSubmit: vi.fn(),
    sendSearchRequestToExtension: vi.fn().mockResolvedValue([]),
    sendActionExecuteToExtension: vi.fn(),
    broadcastSettingsToIframes: vi.fn(),
    forwardKeyToActiveView: vi.fn(),
    handleSearchResponse: vi.fn(),
    sendPreferencesToExtension: vi.fn(),
  }
}))
vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: vi.fn((id: string) => `asyar-extension://${id}`)
}))
vi.mock('../notification/notificationService', () => ({
  NotificationService: vi.fn().mockImplementation(function (this: any) {
    this.notify = vi.fn()
  })
}))
vi.mock('../clipboard/clipboardHistoryService', () => ({
  ClipboardHistoryService: { getInstance: vi.fn().mockReturnValue({ getHistory: vi.fn() }) }
}))
vi.mock('../../lib/ipc/commands', () => ({
  syncCommandIndex: vi.fn().mockResolvedValue({ added: 0, removed: 0, total: 0 }),
  hideWindow: vi.fn(),
  recordItemUsage: vi.fn().mockResolvedValue(true),
  registerExtensionPermissions: vi.fn().mockResolvedValue(undefined),
  setExtensionEnabled: vi.fn().mockResolvedValue(true),
  uninstallExtension: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ai/aiService.svelte', () => ({
  aiExtensionService: { streamChat: vi.fn() }
}))
vi.mock('../auth/entitlementService.svelte', () => ({
  entitlementService: { check: vi.fn().mockReturnValue(true), getAll: vi.fn().mockReturnValue([]) }
}))
vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: { submit: vi.fn() }
}))
vi.mock('../fileManager/fileManagerService', () => ({
  fileManagerService: { open: vi.fn() }
}))
vi.mock('../selection/selectionService', () => ({
  selectionService: { getSelectedText: vi.fn().mockResolvedValue('') }
}))
vi.mock('../oauth/extensionOAuthService.svelte', () => ({
  extensionOAuthService: { startFlow: vi.fn() }
}))
vi.mock('../shell/shellService.svelte', () => ({
  shellService: { run: vi.fn() }
}))
vi.mock('../storage/extensionStorageService', () => ({
  extensionStorageService: { get: vi.fn(), set: vi.fn(), remove: vi.fn() }
}))
vi.mock('../storage/extensionCacheService', () => ({
  extensionCacheService: { get: vi.fn(), set: vi.fn(), remove: vi.fn() }
}))
vi.mock('../application/applicationService', () => ({
  applicationService: { launch: vi.fn() }
}))
vi.mock('../windowManagement/windowManagementService', () => ({
  windowManagementService: { open: vi.fn(), close: vi.fn() }
}))
vi.mock('../interop/interopService.svelte', () => ({
  InteropService: vi.fn().mockImplementation(function (this: any) {
    this.handle = vi.fn()
  })
}))
vi.mock('./extensionSearchAggregator', () => ({
  extensionSearchAggregator: {
    init: vi.fn(),
    searchAll: vi.fn().mockResolvedValue([]),
    resolveExtensionInstance: vi.fn((m: any) => m),
  }
}))
vi.mock('./extensionStateManager.svelte', () => ({
  extensionStateManager: {
    init: vi.fn(),
    isExtensionEnabled: vi.fn().mockReturnValue(true),
    toggleExtensionState: vi.fn().mockResolvedValue(true),
    getAllExtensionsWithState: vi.fn().mockResolvedValue([]),
    getAllExtensions: vi.fn().mockResolvedValue([]),
    recordViewUsage: vi.fn(),
    extensionUninstallInProgress: null,
    extensionUsageStats: {},
  }
}))
vi.mock('./ExtensionLoader', () => ({
  ExtensionLoader: vi.fn().mockImplementation(function (this: any) {
    this.loadExtensions = vi.fn().mockResolvedValue(undefined)
    this.syncCommandIndex = vi.fn().mockResolvedValue(undefined)
  })
}))
vi.mock('./ExtensionIpcRouter', () => ({
  ExtensionIpcRouter: vi.fn().mockImplementation(function (this: any) {
    this.setup = vi.fn()
  })
}))
vi.mock('../context/contextModeService.svelte', () => ({
  contextModeService: { getMode: vi.fn().mockReturnValue('default') }
}))
vi.mock('../theme/themeService', () => ({
  applyTheme: vi.fn().mockResolvedValue(undefined),
  removeTheme: vi.fn(),
}))

// ---------------------------------------------------------------------------

describe('extensionManager – settings-window import order smoke test', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('resolves actionService then extensionManager without throwing (simulates settings-window entry)', async () => {
    // Import actionService first — this is the order the Settings webview
    // module graph traverses these files (barrel → ActionListPopup →
    // actionService, then appInitializer → extensionManager).
    // Before the fix, actionService would still be mid-execution when
    // extensionManager's constructor tried to read it, causing a TDZ crash.
    const actionMod = await import('../action/actionService.svelte')
    expect(actionMod).toBeDefined()
    expect(typeof actionMod.actionService).not.toBe('undefined')

    const extMod = await import('./extensionManager.svelte')
    expect(extMod).toBeDefined()
    expect(typeof extMod.extensionManager).not.toBe('undefined')
  })
})
