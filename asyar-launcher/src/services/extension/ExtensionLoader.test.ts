/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionLoader } from './ExtensionLoader';
import { permissionConsentService } from './permissionConsentService.svelte';

// ---------- hoisted mocks ----------

const mockSearchOrchestrator = vi.hoisted(() => ({ items: [] as any[] }));
vi.mock('../search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: mockSearchOrchestrator,
}));

const mockSearchStores = vi.hoisted(() => ({ selectedIndex: -1 }));
vi.mock('../search/stores/search.svelte', () => ({
  searchStores: mockSearchStores,
}));

const mockSettingsGetSettings = vi.hoisted(() =>
  vi.fn().mockReturnValue({ search: { enableExtensionSearch: false } }),
);
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
}));

// Capture calls to registerAction so we can inspect visible() callbacks
const registeredActions: any[] = [];
vi.mock('../action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn((action: any) => {
      registeredActions.push(action);
    }),
    getAllActions: vi.fn().mockReturnValue([]),
    unregisterAction: vi.fn(),
    clearActionsForExtension: vi.fn(),
    setContext: vi.fn(),
    refreshFiltered: vi.fn(),
    filteredActions: [],
    getSelectedSearchItem: vi.fn(() => {
      const idx = mockSearchStores.selectedIndex;
      return idx >= 0 ? mockSearchOrchestrator.items[idx] : undefined;
    }),
  },
}));

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../extensionLoaderService', () => ({
  extensionLoaderService: {
    loadAllExtensions: vi.fn().mockResolvedValue(new Map()),
    loadSingleExtension: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('../performance/performanceService.svelte', () => ({
  performanceService: {
    init: vi.fn(),
    startTiming: vi.fn(),
    stopTiming: vi.fn().mockReturnValue({ duration: 0 }),
    trackExtensionLoadStart: vi.fn(),
    trackExtensionLoadEnd: vi.fn(),
  },
}));
vi.mock('../envService', () => ({ envService: { isDev: vi.fn().mockReturnValue(false) } }));
vi.mock('../../lib/ipc/commands', () => ({
  syncSearchIndex: vi.fn().mockResolvedValue(undefined),
  syncCommandIndex: vi.fn().mockResolvedValue(undefined),
  showSettingsWindow: vi.fn().mockResolvedValue(undefined),
}));
const mockCommandHandlers = vi.hoisted(() => new Map<string, any>());
vi.mock('./commandService.svelte', () => ({
  commandService: {
    setShortCommandId: vi.fn(),
    registerCommandObjectId: vi.fn(),
    registerCommand: vi.fn((id: string, handler: any) => {
      mockCommandHandlers.set(id, handler);
    }),
    getLiveSubtitle: vi.fn(),
    liveSubtitles: {},
    __handlers: mockCommandHandlers,
  },
}));

vi.mock('./extensionDispatcher.svelte', () => ({ dispatch: vi.fn() }));
vi.mock('./extensionIframeManager.svelte', () => ({
  extensionIframeManager: { getIframeRef: vi.fn() },
}));
vi.mock('./extensionPreferencesService.svelte', () => ({
  extensionPreferencesService: {
    preLoadPreferences: vi.fn().mockResolvedValue(undefined),
    getCurrentPreferences: vi.fn().mockReturnValue({}),
  },
}));

// ---------- helpers ----------

function makeManifest(extensionId: string, commands: any[] = []) {
  return {
    id: extensionId,
    name: extensionId,
    version: '1.0.0',
    description: '',
    type: 'extension' as const,
    permissions: [],
    commands,
  };
}

function makeCommand(cmdId: string) {
  return { id: cmdId, name: cmdId, description: '', trigger: cmdId };
}

function makeLoader(loadedCommands: { cmd: any; manifest: any; isBuiltIn: boolean }[]) {
  const loader = new ExtensionLoader(
    {} as any,
    () => {},
    () => {},
    () => {},
  );
  (loader as any).allLoadedCommands = loadedCommands;
  return loader;
}

// ---------- tests ----------

describe('ExtensionLoader Tier 2 no-view handler routes through dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommandHandlers.clear();
  });

  it('execute() calls dispatch with source=search and the correct payload', async () => {
    const { dispatch } = await import('./extensionDispatcher.svelte');
    const loader = new ExtensionLoader(
      { registerManifest: vi.fn() } as any,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    (loader as any).allLoadedCommands = [
      {
        cmd: { id: 'run', name: 'Run', mode: 'background' },
        manifest: { id: 'ext.a', commands: [] },
        isBuiltIn: false,
      },
    ];
    loader.registerCommandHandlersFromManifests(vi.fn());
    const handler = mockCommandHandlers.get('cmd_ext.a_run');
    expect(handler).toBeDefined();
    await handler.execute({ foo: 1 });

    expect(dispatch).toHaveBeenCalledWith({
      extensionId: 'ext.a',
      kind: 'command',
      payload: { commandId: 'run', args: { foo: 1 } },
      source: 'search',
      commandMode: 'background',
    });
  });
});

describe('ExtensionLoader.syncCommandIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes commands that declare searchable: false from command sync', async () => {
    const { syncCommandIndex } = await import('../../lib/ipc/commands');
    vi.mocked(syncCommandIndex).mockResolvedValueOnce({ added: 1, removed: 0, total: 1 });

    const loader = new ExtensionLoader({} as any, vi.fn(), vi.fn(), vi.fn());
    const manifest = makeManifest('my-ext');

    const visibleCmd = {
      id: 'search-items',
      name: 'Search Items',
      mode: 'view' as const,
      searchable: true,
    };
    const defaultCmd = { id: 'view-logs', name: 'View Logs', mode: 'view' as const };
    const hiddenCmd = {
      id: 'bg-worker',
      name: 'Background Worker',
      mode: 'background' as const,
      searchable: false,
    };

    await loader.syncCommandIndex([
      { cmd: visibleCmd as any, manifest, isBuiltIn: false },
      { cmd: defaultCmd as any, manifest, isBuiltIn: false },
      { cmd: hiddenCmd as any, manifest, isBuiltIn: false },
    ]);

    expect(syncCommandIndex).toHaveBeenCalledTimes(1);
    const passedInputs = vi.mocked(syncCommandIndex).mock.calls[0][0];
    const ids = passedInputs.map((input) => input.id);

    expect(ids).toContain('cmd_my-ext_search-items');
    expect(ids).toContain('cmd_my-ext_view-logs');
    expect(ids).not.toContain('cmd_my-ext_bg-worker');
  });

  it('indexes commands normally when searchable is true or omitted', async () => {
    const { syncCommandIndex } = await import('../../lib/ipc/commands');
    vi.mocked(syncCommandIndex).mockResolvedValueOnce({ added: 2, removed: 0, total: 2 });

    const loader = new ExtensionLoader({} as any, vi.fn(), vi.fn(), vi.fn());
    const manifest = makeManifest('my-ext');

    const cmd1 = { id: 'cmd1', name: 'Command 1', mode: 'view' as const };
    const cmd2 = { id: 'cmd2', name: 'Command 2', mode: 'background' as const, searchable: true };

    await loader.syncCommandIndex([
      { cmd: cmd1 as any, manifest, isBuiltIn: false },
      { cmd: cmd2 as any, manifest, isBuiltIn: false },
    ]);

    expect(syncCommandIndex).toHaveBeenCalledTimes(1);
    const passedInputs = vi.mocked(syncCommandIndex).mock.calls[0][0];
    expect(passedInputs).toHaveLength(2);
    expect(passedInputs[0].id).toBe('cmd_my-ext_cmd1');
    expect(passedInputs[1].id).toBe('cmd_my-ext_cmd2');
  });
});

describe('ExtensionLoader proactive permission consent on command execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommandHandlers.clear();
    permissionConsentService.reset();
  });

  it('executing a background command for an extension in needsReview calls permissionConsentService.ensureConsent and proceeds on accept', async () => {
    const { dispatch } = await import('./extensionDispatcher.svelte');
    permissionConsentService.markNeedsReview('ext.review');
    const ensureConsentSpy = vi
      .spyOn(permissionConsentService, 'ensureConsent')
      .mockResolvedValue(true);

    const loader = new ExtensionLoader(
      { registerManifest: vi.fn() } as any,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    (loader as any).allLoadedCommands = [
      {
        cmd: { id: 'bg-run', name: 'Background Run', mode: 'background' },
        manifest: { id: 'ext.review', name: 'Review Ext', commands: [] },
        isBuiltIn: false,
      },
    ];

    loader.registerCommandHandlersFromManifests(vi.fn());
    const handler = mockCommandHandlers.get('cmd_ext.review_bg-run');
    expect(handler).toBeDefined();

    await handler.execute({ foo: 'bar' });

    expect(ensureConsentSpy).toHaveBeenCalledWith('ext.review', 'Review Ext', 'review');
    expect(dispatch).toHaveBeenCalledWith({
      extensionId: 'ext.review',
      kind: 'command',
      payload: { commandId: 'bg-run', args: { foo: 'bar' } },
      source: 'search',
      commandMode: 'background',
    });
  });

  it('if ensureConsent resolves to false for background command, dispatch is not called', async () => {
    const { dispatch } = await import('./extensionDispatcher.svelte');
    permissionConsentService.markNeedsReview('ext.review');
    const ensureConsentSpy = vi
      .spyOn(permissionConsentService, 'ensureConsent')
      .mockResolvedValue(false);

    const loader = new ExtensionLoader(
      { registerManifest: vi.fn() } as any,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    (loader as any).allLoadedCommands = [
      {
        cmd: { id: 'bg-run', name: 'Background Run', mode: 'background' },
        manifest: { id: 'ext.review', name: 'Review Ext', commands: [] },
        isBuiltIn: false,
      },
    ];

    loader.registerCommandHandlersFromManifests(vi.fn());
    const handler = mockCommandHandlers.get('cmd_ext.review_bg-run');
    expect(handler).toBeDefined();

    await handler.execute();

    expect(ensureConsentSpy).toHaveBeenCalledWith('ext.review', 'Review Ext', 'review');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('executing a view command for an extension in needsReview calls permissionConsentService.ensureConsent and proceeds on accept', async () => {
    const navigateToView = vi.fn();
    permissionConsentService.markNeedsReview('ext.review');
    const ensureConsentSpy = vi
      .spyOn(permissionConsentService, 'ensureConsent')
      .mockResolvedValue(true);

    const loader = new ExtensionLoader(
      { registerManifest: vi.fn() } as any,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    (loader as any).allLoadedCommands = [
      {
        cmd: { id: 'open-view', name: 'Open View', mode: 'view', component: 'Main' },
        manifest: { id: 'ext.review', name: 'Review Ext', commands: [] },
        isBuiltIn: false,
      },
    ];

    loader.registerCommandHandlersFromManifests(navigateToView);
    const handler = mockCommandHandlers.get('cmd_ext.review_open-view');
    expect(handler).toBeDefined();

    await handler.execute();

    expect(ensureConsentSpy).toHaveBeenCalledWith('ext.review', 'Review Ext', 'review');
    expect(navigateToView).toHaveBeenCalledWith('ext.review/Main');
  });

  it('if ensureConsent resolves to false for view command, navigateToView is not called', async () => {
    const navigateToView = vi.fn();
    permissionConsentService.markNeedsReview('ext.review');
    const ensureConsentSpy = vi
      .spyOn(permissionConsentService, 'ensureConsent')
      .mockResolvedValue(false);

    const loader = new ExtensionLoader(
      { registerManifest: vi.fn() } as any,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    (loader as any).allLoadedCommands = [
      {
        cmd: { id: 'open-view', name: 'Open View', mode: 'view', component: 'Main' },
        manifest: { id: 'ext.review', name: 'Review Ext', commands: [] },
        isBuiltIn: false,
      },
    ];

    loader.registerCommandHandlersFromManifests(navigateToView);
    const handler = mockCommandHandlers.get('cmd_ext.review_open-view');
    expect(handler).toBeDefined();

    await handler.execute();

    expect(ensureConsentSpy).toHaveBeenCalledWith('ext.review', 'Review Ext', 'review');
    expect(navigateToView).not.toHaveBeenCalled();
  });

  it('an extension with already-granted consent proceeds directly without opening consent dialog', async () => {
    const navigateToView = vi.fn();
    const ensureConsentSpy = vi.spyOn(permissionConsentService, 'ensureConsent');

    const loader = new ExtensionLoader(
      { registerManifest: vi.fn() } as any,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    (loader as any).allLoadedCommands = [
      {
        cmd: { id: 'open-view', name: 'Open View', mode: 'view', component: 'Main' },
        manifest: { id: 'ext.clean', name: 'Clean Ext', commands: [] },
        isBuiltIn: false,
      },
    ];

    loader.registerCommandHandlersFromManifests(navigateToView);
    const handler = mockCommandHandlers.get('cmd_ext.clean_open-view');
    expect(handler).toBeDefined();

    await handler.execute();

    expect(ensureConsentSpy).not.toHaveBeenCalled();
    expect(navigateToView).toHaveBeenCalledWith('ext.clean/Main');
  });
});
