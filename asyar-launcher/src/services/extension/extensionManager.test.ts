import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get } from 'svelte/store'

// Mock browser globals for Node environment at the very top
if (typeof window === 'undefined') {
  const messageHandlers: any[] = [];
  (global as any).window = {
    addEventListener: vi.fn((type, handler) => {
      if (type === 'message') messageHandlers.push(handler);
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: (event: any) => {
      if (event.type === 'message') {
        // @ts-ignore
        // console.log(`Dispatching message: ${JSON.stringify(event.data)}, Handlers: ${messageHandlers.length}`);
        messageHandlers.forEach((h) => h(event));
      }
    },
    location: { origin: 'http://localhost' },
    postMessage: vi.fn(),
    _messageHandlers: messageHandlers
  };
}
if (typeof document === 'undefined') {
  (global as any).document = {
    querySelectorAll: vi.fn().mockReturnValue([]),
    querySelector: vi.fn().mockReturnValue(null),
  };
}
if (typeof MessageEvent === 'undefined') {
  (global as any).MessageEvent = class {
    constructor(public type: string, init: any) {
      Object.assign(this, init);
    }
  };
}

// Mock all external dependencies
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), custom: vi.fn() }
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(), readDir: vi.fn(), remove: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn(), resourceDir: vi.fn(), appDataDir: vi.fn() }))
vi.mock('asyar-sdk', () => ({
  ExtensionBridge: {
    getInstance: vi.fn().mockReturnValue({
      registerManifest: vi.fn(),
      registerExtensionImplementation: vi.fn(),
      initializeExtensions: vi.fn().mockResolvedValue(true),
      activateExtensions: vi.fn().mockResolvedValue(true),
      deactivateExtensions: vi.fn().mockResolvedValue(true),
    })
  }
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('../settings/settingsService', () => ({
  settingsService: {
    isInitialized: vi.fn().mockReturnValue(true),
    init: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => {}),
    isExtensionEnabled: vi.fn().mockReturnValue(true),
    getSettings: vi.fn().mockReturnValue({ calculator: {} }),
    updateSettings: vi.fn(),
    updateExtensionState: vi.fn(),
    removeExtensionState: vi.fn(),
  }
}))
vi.mock('../performance/performanceService', () => ({
  performanceService: {
    init: vi.fn(),
    startTiming: vi.fn(),
    stopTiming: vi.fn().mockReturnValue({ duration: 0 }),
    trackExtensionLoadStart: vi.fn(),
    trackExtensionLoadEnd: vi.fn(),
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
  isBuiltInExtension: vi.fn().mockReturnValue(false),
}))
vi.mock('./commandService', () => ({
  commandService: {
    registerCommand: vi.fn(),
    executeCommand: vi.fn().mockResolvedValue(undefined),
    clearCommandsForExtension: vi.fn(),
    getCommands: vi.fn().mockReturnValue([]),
  }
}))
vi.mock('./viewManager', () => ({
  viewManager: {
    init: vi.fn(),
    navigateToView: vi.fn(),
    goBack: vi.fn(),
    getActiveView: vi.fn().mockReturnValue(null),
    isViewActive: vi.fn().mockReturnValue(false),
    getNavigationStackSize: vi.fn().mockReturnValue(0),
    handleViewSearch: vi.fn().mockResolvedValue(undefined),
    handleViewSubmit: vi.fn().mockResolvedValue(undefined),
  },
  activeView: { subscribe: vi.fn().mockReturnValue(() => {}) },
  activeViewSearchable: { subscribe: vi.fn().mockReturnValue(() => {}) },
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
vi.mock('../action/actionService', () => ({
  actionService: { setExtensionForwarder: vi.fn() }
}))
vi.mock('../statusBar/statusBarService', () => ({
  statusBarService: { clearItemsForExtension: vi.fn() }
}))
vi.mock('../envService', () => ({ envService: { isTauri: false } }))
vi.mock('../permissionGate', () => ({
  checkPermission: vi.fn().mockReturnValue({ allowed: true })
}))
vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: vi.fn((id: string) => `asyar-extension://${id}`)
}))
vi.mock('../notification/notificationService', () => {
  return {
    NotificationService: vi.fn().mockImplementation(function() {
      // @ts-ignore
      this.notify = vi.fn();
    })
  }
})
vi.mock('../clipboard/clipboardHistoryService', () => ({
  ClipboardHistoryService: { getInstance: vi.fn().mockReturnValue({ getHistory: vi.fn() }) }
}))
vi.mock('../ui/uiStateStore', () => ({
  activeViewPrimaryActionLabel: { set: vi.fn() },
  activeViewStatusMessage: { set: vi.fn() },
}))

// Import dependencies that we need to use vi.mocked on
import { isBuiltInExtension } from './extensionDiscovery'
import { invoke } from '@tauri-apps/api/core'
import { extensionLoaderService } from '../extensionLoaderService'
import { commandService } from './commandService'
import { viewManager } from './viewManager'
import { settingsService } from '../settings/settingsService'
import { actionService } from '../action/actionService'
import { checkPermission } from '../permissionGate'
import { logService } from '../log/logService'
import { performanceService } from '../performance/performanceService'

// We will import the extensionManager dynamically to ensure globals are set
let extensionManager: any;
let extensionUsageStats: any;

describe('ExtensionManager Characterization Tests', () => {
  let actionForwarderCalledCount = 0;

  beforeEach(async () => {
    vi.clearAllMocks()
    
    if (!extensionManager) {
      // Track calls before import if possible, but here we just import
      const mod = await import('./extensionManager');
      extensionManager = mod.default;
      extensionUsageStats = mod.extensionUsageStats;
      // Count how many times it was called during first import
      actionForwarderCalledCount = vi.mocked(actionService.setExtensionForwarder).mock.calls.length;
    }

    // Reset internal state
    extensionManager.initialized = false
    extensionManager.manifestsById.clear()
    extensionManager.extensionModulesById.clear()
    extensionManager.allLoadedCommands = []
    
    // Reset usage stats
    extensionUsageStats.set({})

    // Spy on methods
    vi.spyOn(extensionManager, 'getManifestById')
    vi.spyOn(extensionManager, 'navigateToView')
  })

  describe('constructor', () => {
    it('does not throw', () => {
      expect(extensionManager).toBeDefined()
    })

    it('registers the action forwarder', () => {
      // It should have been called at least once during module load
      expect(actionForwarderCalledCount).toBeGreaterThan(0)
    })
  })

  describe('init()', () => {
    it('returns true on successful initialization', async () => {
      const result = await extensionManager.init()
      expect(result).toBe(true)
    })

    it('returns false on error', async () => {
      (extensionManager as any).initialized = false;
      const error = new Error('Init failed');
      vi.mocked(performanceService.init).mockRejectedValueOnce(error)
      
      const result = await extensionManager.init()
      
      expect(result).toBe(false)
      expect(logService.error).toHaveBeenCalledWith(expect.stringContaining(`Failed to initialize extension manager: ${error}`))
      
      // Reset for subsequent tests (performanceService.init is a spy returning Promise<void> usually)
      vi.mocked(performanceService.init).mockResolvedValue(undefined as any)
    })

    it('marks initialized = true after first call', async () => {
      await extensionManager.init()
      // @ts-ignore
      expect(extensionManager.initialized).toBe(true)
    })

    it('skips re-initialization if called twice', async () => {
      await extensionManager.init()
      vi.clearAllMocks()
      await extensionManager.init()
      expect(extensionLoaderService.loadAllExtensions).not.toHaveBeenCalled()
    })

    it('calls extensionLoaderService.loadAllExtensions()', async () => {
      await extensionManager.init()
      expect(extensionLoaderService.loadAllExtensions).toHaveBeenCalled()
    })

    it('calls viewManager.init() with manifestsById', async () => {
      await extensionManager.init()
      expect(viewManager.init).toHaveBeenCalled()
    })

    it('calls syncCommandIndex after loading', async () => {
      const spy = vi.spyOn(extensionManager as any, 'syncCommandIndex')
      await extensionManager.init()
      expect(spy).toHaveBeenCalled()
    })

    it('loadExtensions() processes loaded extensions from extensionLoaderService', async () => {
      const mockManifest = { id: 'test-ext', name: 'Test', commands: [{ id: 'cmd1', name: 'Cmd 1' }] }
      const mockModule = { default: { executeCommand: vi.fn(), search: vi.fn() } }
      const loadedMap = new Map([['test-ext', { module: mockModule, manifest: mockManifest, isBuiltIn: false }]])
      vi.mocked(extensionLoaderService.loadAllExtensions).mockResolvedValue(loadedMap as any)
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true)

      await extensionManager.init()

      // @ts-ignore - accessing private field for characterization
      expect(extensionManager.manifestsById.has('test-ext')).toBe(true)
      // @ts-ignore
      expect(extensionManager.extensionModulesById.has('test-ext')).toBe(true)
    })

    it('syncCommandIndex() calls searchService.batchIndexItems with loaded commands', async () => {
      const { searchService } = await import('../search/SearchService')
      const mockManifest = { id: 'test-ext', name: 'Test', commands: [{ id: 'cmd1', name: 'Cmd 1', trigger: 'test' }] }
      const mockModule = { default: { executeCommand: vi.fn() } }
      const loadedMap = new Map([['test-ext', { module: mockModule, manifest: mockManifest, isBuiltIn: false }]])
      vi.mocked(extensionLoaderService.loadAllExtensions).mockResolvedValue(loadedMap as any)
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true)

      await extensionManager.init()

      expect(searchService.batchIndexItems).toHaveBeenCalled()
      const call = vi.mocked(searchService.batchIndexItems).mock.calls[0]
      expect(call[0].length).toBeGreaterThan(0)
      expect(call[0][0].id).toBe('cmd_test-ext_cmd1')
    })

    it('syncCommandIndex() deletes stale commands not in current set', async () => {
      const { searchService } = await import('../search/SearchService')
      // No extensions loaded, but there's a stale command in the index
      vi.mocked(searchService.getIndexedObjectIds).mockResolvedValue(new Set(['cmd_old-ext_old-cmd']))
      vi.mocked(extensionLoaderService.loadAllExtensions).mockResolvedValue(new Map() as any)

      await extensionManager.init()

      expect(searchService.deleteItem).toHaveBeenCalledWith('cmd_old-ext_old-cmd')
    })
  })

  describe('handleCommandAction()', () => {
    it('calls commandService.executeCommand with the objectId', async () => {
      await extensionManager.handleCommandAction('test_cmd')
      expect(commandService.executeCommand).toHaveBeenCalledWith('test_cmd', undefined)
    })

    it('navigates to store view for ext_store fallback id', async () => {
      const spy = vi.spyOn(extensionManager, 'navigateToView')
      await extensionManager.handleCommandAction('ext_store')
      expect(spy).toHaveBeenCalledWith('store/DefaultView')
    })

    it('navigates to clipboard view for ext_clipboard fallback id', async () => {
      const spy = vi.spyOn(extensionManager, 'navigateToView')
      await extensionManager.handleCommandAction('ext_clipboard')
      expect(spy).toHaveBeenCalledWith('clipboard-history/DefaultView')
    })

    it('does not throw on executeCommand failure', async () => {
      vi.mocked(commandService.executeCommand).mockRejectedValueOnce(new Error('Execute failed'))
      await expect(extensionManager.handleCommandAction('test_cmd')).resolves.not.toThrow()
    })
  })

  describe('searchAll()', () => {
    it('returns empty array when no extensions are loaded', async () => {
      const results = await extensionManager.searchAll('query')
      expect(results).toEqual([])
    })

    it('calls search() on loaded extension instances that have it', async () => {
      const mockExt = { search: vi.fn().mockResolvedValue([{ title: 'Result' }]) }
      // @ts-ignore
      extensionManager.extensionModulesById.set('test-ext', mockExt)
      // @ts-ignore
      extensionManager.manifestsById.set('test-ext', { id: 'test-ext' })
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true)

      const results = await extensionManager.searchAll('query')
      expect(mockExt.search).toHaveBeenCalledWith('query')
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Result')
    })

    it('skips extension instances that do not have search()', async () => {
      const mockExt = { noSearch: vi.fn() }
      // @ts-ignore
      extensionManager.extensionModulesById.set('test-ext', mockExt)
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true)

      const results = await extensionManager.searchAll('query')
      expect(results).toEqual([])
    })

    it('returns [] and logs error if one extension throws', async () => {
      const mockExt = { search: vi.fn().mockRejectedValue(new Error('Search failed')) }
      // @ts-ignore
      extensionManager.extensionModulesById.set('test-ext', mockExt)
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true)

      const results = await extensionManager.searchAll('query')
      expect(results).toEqual([])
    })

    it('returns partial results when an extension search exceeds 200ms timeout', async () => {
      // Fast extension resolves immediately
      const fastExt = { search: vi.fn().mockResolvedValue([{ title: 'Fast Result', score: 0.9 }]) }
      // Slow extension takes 500ms — will exceed the 200ms timeout
      const slowExt = { search: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([{ title: 'Slow Result', score: 0.5 }]), 500))) }
      
      // @ts-ignore
      extensionManager.extensionModulesById.set('fast-ext', fastExt)
      // @ts-ignore
      extensionManager.extensionModulesById.set('slow-ext', slowExt)
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true)

      const results = await extensionManager.searchAll('query')
      
      // Fast extension's results should be present
      expect(results.some((r: any) => r.title === 'Fast Result')).toBe(true)
      // Slow extension's results should NOT be present (timed out)
      expect(results.some((r: any) => r.title === 'Slow Result')).toBe(false)
    })
  })

  describe('navigateToView()', () => {
    it('delegates to viewManager.navigateToView', () => {
      extensionManager.navigateToView('test/View')
      expect(viewManager.navigateToView).toHaveBeenCalledWith('test/View')
    })

    it('updates extensionUsageStats for the extension', () => {
      // @ts-ignore
      extensionManager.manifestsById.set('test', { id: 'test', name: 'Test' })
      extensionManager.navigateToView('test/View')
      const stats = get(extensionUsageStats) as Record<string, number>
      expect(stats['test']).toBe(1)
    })
  })

  describe('goBack()', () => {
    it('delegates to viewManager.goBack', () => {
      extensionManager.goBack()
      expect(viewManager.goBack).toHaveBeenCalled()
    })
  })

  describe('getManifestById()', () => {
    it('returns undefined for unknown id', () => {
      expect(extensionManager.getManifestById('unknown')).toBeUndefined()
    })

    it('returns the manifest after init with a loaded extension', () => {
      // @ts-ignore
      extensionManager.manifestsById.set('test', { id: 'test' })
      expect(extensionManager.getManifestById('test')).toEqual({ id: 'test' })
    })
  })

  describe('toggleExtensionState()', () => {
    it('returns false and logs when trying to disable a built-in extension', async () => {
      vi.mocked(isBuiltInExtension).mockReturnValue(true)
      const result = await extensionManager.toggleExtensionState('builtin', false)
      expect(result).toBe(false)
    })

    it('calls settingsService.updateExtensionState with correct args', async () => {
      vi.mocked(isBuiltInExtension).mockReturnValue(false)
      vi.mocked(settingsService.updateExtensionState).mockResolvedValue(true)
      await extensionManager.toggleExtensionState('installed', true)
      expect(settingsService.updateExtensionState).toHaveBeenCalledWith('installed', true)
    })
  })

  describe('isExtensionEnabled()', () => {
    it('returns true for built-in extensions regardless of settings', () => {
      vi.mocked(isBuiltInExtension).mockReturnValue(true)
      expect(extensionManager.isExtensionEnabled('builtin')).toBe(true)
    })

    it('delegates to settingsService for installed extensions', () => {
      vi.mocked(isBuiltInExtension).mockReturnValue(false)
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(false)
      expect(extensionManager.isExtensionEnabled('installed')).toBe(false)
      expect(settingsService.isExtensionEnabled).toHaveBeenCalledWith('installed')
    })
  })

  describe('IPC handler — setupIpcHandler()', () => {
    // These tests dispatch postMessage events to window and check outcomes.

    it('ignores messages that do not start with asyar:', async () => {
      window.dispatchEvent({ type: 'message', data: { type: 'other:msg' }, source: window } as any)
      // Should not call any service
      expect(vi.mocked(checkPermission)).not.toHaveBeenCalled()
    })

    it('ignores asyar:response messages (prevents loops)', async () => {
      window.dispatchEvent({ type: 'message', data: { type: 'asyar:response' }, source: window } as any)
      expect(vi.mocked(checkPermission)).not.toHaveBeenCalled()
    })

    it('rejects messages from iframes without extensionId', async () => {
      const mockIframeWindow = { postMessage: vi.fn() } as any
      window.dispatchEvent({ type: 'message', 
        data: { type: 'asyar:api:test' }, 
        source: mockIframeWindow 
      } as any)
      // It should log error and return
      expect(vi.mocked(checkPermission)).not.toHaveBeenCalled()
    })

    it('rejects messages from unregistered iframe extensionId', async () => {
      const mockIframeWindow = { postMessage: vi.fn() } as any
      window.dispatchEvent({ type: 'message', 
        data: { type: 'asyar:api:test', extensionId: 'unknown' }, 
        source: mockIframeWindow 
      } as any)
      
      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 0))
      
      expect(mockIframeWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Unknown extension: unknown' }),
        expect.any(String)
      )
    })

    it('allows messages from window itself (privileged host context)', async () => {
      // @ts-ignore
      extensionManager.serviceRegistry['LogService'].info = vi.fn()
      window.dispatchEvent({ type: 'message', 
        data: { type: 'asyar:api:log:info', payload: ['Hello'] }, 
        source: window 
      } as any)
      
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(extensionManager.getManifestById).not.toHaveBeenCalled() // Bypassed for host
    })

    it('blocks BLOCKED_EXTENSION_INVOKE_COMMANDS for iframe extensions', async () => {
      const mockIframeWindow = { postMessage: vi.fn() } as any
      // @ts-ignore
      extensionManager.manifestsById.set('ext1', { id: 'ext1', permissions: ['native-api'] })
      
      window.dispatchEvent({ type: 'message', 
        data: { type: 'asyar:api:invoke', extensionId: 'ext1', payload: { cmd: 'uninstall_extension' }, messageId: '1' }, 
        source: mockIframeWindow 
      } as any)
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(mockIframeWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: expect.stringContaining('not available to extensions') }),
        expect.any(String)
      )
    })

    it('allows BLOCKED_EXTENSION_INVOKE_COMMANDS for privileged host context', async () => {
      vi.mocked(window.postMessage).mockClear();
      window.dispatchEvent({
        type: 'message',
        data: {
          type: 'asyar:api:invoke',
          payload: { cmd: 'uninstall_extension', args: {} },
          messageId: 'test-id-priv',
        },
        source: window,
      } as any);

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(window.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'asyar:response', success: true }),
        expect.anything()
      );
    })

    it('calls checkPermission for iframe messages', async () => {
      const mockIframeWindow = { postMessage: vi.fn() } as any
      // @ts-ignore
      extensionManager.manifestsById.set('ext1', { id: 'ext1', permissions: [] })
      
      window.dispatchEvent({ type: 'message', 
        data: { type: 'asyar:api:log:info', extensionId: 'ext1' }, 
        source: mockIframeWindow 
      } as any)
      
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(checkPermission).toHaveBeenCalled()
    })

    it('posts asyar:response with success: false when checkPermission returns not allowed', async () => {
      const mockIframeWindow = { postMessage: vi.fn() } as any
      // @ts-ignore
      extensionManager.manifestsById.set('ext1', { id: 'ext1', permissions: [] })
      vi.mocked(checkPermission).mockReturnValueOnce({ allowed: false, reason: 'No permission', requiredPermission: 'log' } as any)
      
      window.dispatchEvent({ type: 'message', 
        data: { type: 'asyar:api:log:info', extensionId: 'ext1', messageId: '1' }, 
        source: mockIframeWindow 
      } as any)
      
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(mockIframeWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: expect.stringContaining('Permission denied') }),
        expect.any(String)
      )
    })
  })
})
