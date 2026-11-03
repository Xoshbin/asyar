// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsHandler, DEFAULT_SETTINGS } from './settingsHandlers.svelte';
import { permissionConsentService } from '../../services/extension/permissionConsentService.svelte';

const { mockGetAll, mockToggleExtensionState } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockToggleExtensionState: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/extension/extensionManager.svelte', () => ({
  default: {
    getAllExtensionsWithState: mockGetAll,
    toggleExtensionState: mockToggleExtensionState,
  },
}));
const { listenMock, onFocusChangedMock, setFocusMock, getCurrentWindowMock } = vi.hoisted(() => {
  const onFocusChangedMock = vi.fn();
  const setFocusMock = vi.fn();
  return {
    listenMock: vi.fn(),
    onFocusChangedMock,
    setFocusMock,
    getCurrentWindowMock: vi.fn(() => ({
      onFocusChanged: onFocusChangedMock,
      isFocused: vi.fn().mockResolvedValue(true),
      setFocus: setFocusMock,
    })),
  };
});
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: getCurrentWindowMock }));
const { mockUpdateSettings } = vi.hoisted(() => ({
  mockUpdateSettings: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    init: vi.fn().mockResolvedValue(true),
    currentSettings: {},
    updateSettings: mockUpdateSettings,
    getSettings: vi.fn().mockReturnValue({}),
  },
  settings: { subscribe: vi.fn() },
}));
vi.mock('../../services/extension/extensionStateManager.svelte', () => ({
  extensionStateManager: {},
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {},
}));
vi.mock('../../services/log/logService', () => ({
  logService: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('svelte', () => ({ onMount: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('../../utils/shortcutManager', () => ({ updateShortcut: vi.fn() }));

describe('SettingsHandler.loadExtensions', () => {
  it('maps manifest commands onto each ExtensionItem', async () => {
    mockGetAll.mockResolvedValue([
      {
        isBuiltIn: false,
        title: 'Pomodoro',
        enabled: true,
        type: 'extension',
        commands: [
          {
            id: 'cmd1',
            name: 'Start Timer',
            description: 'Starts the timer',
            trigger: 'pomo start',
          },
        ],
      },
    ]);

    const handler = new SettingsHandler();
    await handler.loadExtensions();

    expect(handler.extensions.filter((e) => e.id !== 'browsers')).toHaveLength(1);
    expect(handler.extensions[0].commands).toEqual([
      { id: 'cmd1', name: 'Start Timer', description: 'Starts the timer', trigger: 'pomo start' },
    ]);
  });

  it('sets commands to empty array when manifest has no commands', async () => {
    mockGetAll.mockResolvedValue([
      { isBuiltIn: false, title: 'Catppuccin', enabled: true, type: 'theme', commands: [] },
    ]);

    const handler = new SettingsHandler();
    await handler.loadExtensions();

    expect(handler.extensions[0].commands).toEqual([]);
  });

  it('includes built-in extensions alongside third-party ones', async () => {
    mockGetAll.mockResolvedValue([
      { isBuiltIn: true, title: 'Calculator', enabled: true, commands: [] },
      { isBuiltIn: false, title: 'GitHub', enabled: true, commands: [] },
    ]);

    const handler = new SettingsHandler();
    await handler.loadExtensions();

    const real = handler.extensions.filter((e) => e.id !== 'browsers');
    expect(real).toHaveLength(2);
    expect(real.map((e) => e.title).sort()).toEqual(['Calculator', 'GitHub']);
  });

  it('adds the manifest-less Browsers built-in so it can be configured', async () => {
    mockGetAll.mockResolvedValue([]);

    const handler = new SettingsHandler();
    await handler.loadExtensions();

    expect(handler.extensions).toHaveLength(1);
    expect(handler.extensions[0]).toMatchObject({
      id: 'browsers',
      isBuiltIn: true,
      disableable: false,
      enabled: true,
      commands: [],
    });
  });

  it('does not duplicate Browsers when the registry already provides it', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'browsers', isBuiltIn: true, title: 'Browsers', enabled: true, commands: [] },
    ]);

    const handler = new SettingsHandler();
    await handler.loadExtensions();

    expect(handler.extensions.filter((e) => e.id === 'browsers')).toHaveLength(1);
  });

  it('selectTab switches the tab and bumps tabResetCounter even for the active tab', () => {
    const handler = new SettingsHandler();
    handler.selectTab('extensions');
    handler.selectTab('extensions');
    expect(handler.activeTab).toBe('extensions');
    expect(handler.tabResetCounter).toBe(2);
  });

  it('deduplicates by id across repeated entries', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'calculator', isBuiltIn: true, title: 'Calculator', enabled: true, commands: [] },
      { id: 'calculator', isBuiltIn: true, title: 'Calculator', enabled: true, commands: [] },
    ]);

    const handler = new SettingsHandler();
    await handler.loadExtensions();

    expect(handler.extensions.filter((e) => e.id === 'calculator')).toHaveLength(1);
  });

  it('ignores a call that starts while a previous call is still in flight', async () => {
    let resolveFirst: (value: unknown[]) => void = () => {};
    mockGetAll.mockReset().mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const handler = new SettingsHandler();
    const firstCall = handler.loadExtensions();
    const secondCall = handler.loadExtensions();

    resolveFirst([]);
    await Promise.all([firstCall, secondCall]);

    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });

  it('allows a new call once the previous one has finished', async () => {
    mockGetAll.mockReset().mockResolvedValue([]);

    const handler = new SettingsHandler();
    await handler.loadExtensions();
    await handler.loadExtensions();

    expect(mockGetAll).toHaveBeenCalledTimes(2);
  });
});

describe('SettingsHandler.init — extension list freshness', () => {
  beforeEach(() => {
    mockGetAll.mockReset().mockResolvedValue([]);
    listenMock.mockClear().mockImplementation(() => Promise.resolve(() => {}));
    onFocusChangedMock.mockClear().mockImplementation(() => Promise.resolve(() => {}));
  });

  it('reloads extensions when an extensions_updated event fires', async () => {
    let onExtensionsUpdated: (() => void) | undefined;
    listenMock.mockImplementation((eventName: string, cb: () => void) => {
      if (eventName === 'extensions_updated') onExtensionsUpdated = cb;
      return Promise.resolve(() => {});
    });

    const handler = new SettingsHandler();
    await handler.init();
    expect(mockGetAll).toHaveBeenCalledTimes(1);

    onExtensionsUpdated?.();
    await vi.waitFor(() => expect(mockGetAll).toHaveBeenCalledTimes(2));
  });

  it('reloads extensions when the settings window regains focus', async () => {
    let onFocusChanged: ((e: { payload: boolean }) => void) | undefined;
    onFocusChangedMock.mockImplementation((cb: (e: { payload: boolean }) => void) => {
      onFocusChanged = cb;
      return Promise.resolve(() => {});
    });

    const handler = new SettingsHandler();
    await handler.init();
    expect(mockGetAll).toHaveBeenCalledTimes(1);

    onFocusChanged?.({ payload: true });
    await vi.waitFor(() => expect(mockGetAll).toHaveBeenCalledTimes(2));
  });

  it('does not reload extensions when the settings window loses focus', async () => {
    let onFocusChanged: ((e: { payload: boolean }) => void) | undefined;
    onFocusChangedMock.mockImplementation((cb: (e: { payload: boolean }) => void) => {
      onFocusChanged = cb;
      return Promise.resolve(() => {});
    });

    const handler = new SettingsHandler();
    await handler.init();
    expect(mockGetAll).toHaveBeenCalledTimes(1);

    onFocusChanged?.({ payload: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });

  it('destroy() unsubscribes the extensions_updated and window-focus listeners', async () => {
    const unlistenExtensionsUpdated = vi.fn();
    const unlistenFocus = vi.fn();
    listenMock.mockImplementation((eventName: string) =>
      eventName === 'extensions_updated'
        ? Promise.resolve(unlistenExtensionsUpdated)
        : Promise.resolve(() => {}),
    );
    onFocusChangedMock.mockResolvedValue(unlistenFocus);

    const handler = new SettingsHandler();
    await handler.init();
    handler.destroy();

    expect(unlistenExtensionsUpdated).toHaveBeenCalledOnce();
    expect(unlistenFocus).toHaveBeenCalledOnce();
  });
});

describe('SettingsHandler.init — consent cross-window sync', () => {
  beforeEach(() => {
    mockGetAll.mockReset().mockResolvedValue([]);
    listenMock.mockClear().mockImplementation(() => Promise.resolve(() => {}));
    onFocusChangedMock.mockClear().mockImplementation(() => Promise.resolve(() => {}));
  });

  it('bumps permissionConsentService.consentVersion when asyar:consent-changed fires', async () => {
    let onConsentChanged: ((event: { payload: { extensionId: string } }) => void) | undefined;
    listenMock.mockImplementation((eventName: string, cb: any) => {
      if (eventName === 'asyar:consent-changed') onConsentChanged = cb;
      return Promise.resolve(() => {});
    });

    const handler = new SettingsHandler();
    await handler.init();

    const before = permissionConsentService.consentVersion;
    onConsentChanged?.({ payload: { extensionId: 'ext.a' } });

    expect(permissionConsentService.consentVersion).toBe(before + 1);
  });

  it('destroy() unsubscribes the asyar:consent-changed listener', async () => {
    const unlistenConsentChanged = vi.fn();
    listenMock.mockImplementation((eventName: string) =>
      eventName === 'asyar:consent-changed'
        ? Promise.resolve(unlistenConsentChanged)
        : Promise.resolve(() => {}),
    );

    const handler = new SettingsHandler();
    await handler.init();
    handler.destroy();

    expect(unlistenConsentChanged).toHaveBeenCalledOnce();
  });
});

describe('SettingsHandler — AI settings handlers', () => {
  beforeEach(() => {
    mockGetAll.mockResolvedValue([]);
    mockUpdateSettings.mockClear();
  });

  it('handleSetDefaultAgentId calls updateSettings with defaultAgentId', async () => {
    const handler = new SettingsHandler();
    await (
      handler as unknown as { handleSetDefaultAgentId(id: string | null): Promise<void> }
    ).handleSetDefaultAgentId('agent-abc');
    expect(mockUpdateSettings).toHaveBeenCalledWith('ai', { defaultAgentId: 'agent-abc' });
  });

  it('handleSetDefaultAgentId accepts null to clear the default agent', async () => {
    const handler = new SettingsHandler();
    await (
      handler as unknown as { handleSetDefaultAgentId(id: string | null): Promise<void> }
    ).handleSetDefaultAgentId(null);
    expect(mockUpdateSettings).toHaveBeenCalledWith('ai', { defaultAgentId: null });
  });

  it('handleToggleTabContinuesLastThread calls updateSettings with tabContinuesLastThread true', async () => {
    const handler = new SettingsHandler();
    await (
      handler as unknown as { handleToggleTabContinuesLastThread(v: boolean): Promise<void> }
    ).handleToggleTabContinuesLastThread(true);
    expect(mockUpdateSettings).toHaveBeenCalledWith('ai', { tabContinuesLastThread: true });
  });

  it('handleToggleTabContinuesLastThread calls updateSettings with tabContinuesLastThread false', async () => {
    const handler = new SettingsHandler();
    await (
      handler as unknown as { handleToggleTabContinuesLastThread(v: boolean): Promise<void> }
    ).handleToggleTabContinuesLastThread(false);
    expect(mockUpdateSettings).toHaveBeenCalledWith('ai', { tabContinuesLastThread: false });
  });

  it('handleHistoryRetentionCapChange calls updateSettings with historyRetentionCap', async () => {
    const handler = new SettingsHandler();
    await (
      handler as unknown as { handleHistoryRetentionCapChange(v: number): Promise<void> }
    ).handleHistoryRetentionCapChange(50);
    expect(mockUpdateSettings).toHaveBeenCalledWith('ai', { historyRetentionCap: 50 });
  });

  it('DEFAULT_SETTINGS.ai does not include legacy AI-Chat keys', () => {
    const ai = DEFAULT_SETTINGS.ai as unknown as Record<string, unknown>;
    expect(ai).not.toHaveProperty('activeProviderId');
    expect(ai).not.toHaveProperty('activeModelId');
    expect(ai).not.toHaveProperty('systemPrompt');
    expect(ai).not.toHaveProperty('allowExtensionUse');
    // New keys must be present with defaults
    expect(ai).toHaveProperty('defaultAgentId', null);
    expect(ai).toHaveProperty('tabContinuesLastThread', false);
    expect(ai).toHaveProperty('historyRetentionCap', 100);
  });
});

describe('SettingsHandler — general settings handlers', () => {
  beforeEach(() => {
    mockUpdateSettings.mockClear();
  });

  it('handleDockIconToggle toggles showDockIcon', async () => {
    const handler = new SettingsHandler();
    handler.settings.general.showDockIcon = false;
    await handler.handleDockIconToggle();
    expect(mockUpdateSettings).toHaveBeenCalledWith('general', { showDockIcon: true });
  });

  it('handleTrayIconToggle toggles showTrayIcon', async () => {
    const handler = new SettingsHandler();
    handler.settings.general.showTrayIcon = true;
    await handler.handleTrayIconToggle();
    expect(mockUpdateSettings).toHaveBeenCalledWith('general', { showTrayIcon: false });
  });
});

describe('SettingsHandler.toggleExtension', () => {
  beforeEach(() => {
    mockToggleExtensionState.mockClear();
  });

  it('does nothing when extension is a non-disableable built-in', async () => {
    const handler = new SettingsHandler();
    const ext = {
      id: 'calculator',
      title: 'Calculator',
      isBuiltIn: true,
      disableable: false,
      enabled: true,
      commands: [],
    };
    await handler.toggleExtension(ext as any);
    expect(mockToggleExtensionState).not.toHaveBeenCalled();
    expect(ext.enabled).toBe(true);
  });

  it('toggles state for disableable built-in extensions (e.g. clipboard-history)', async () => {
    const handler = new SettingsHandler();
    const ext = {
      id: 'clipboard-history',
      title: 'Clipboard History',
      isBuiltIn: true,
      disableable: true,
      enabled: true,
      commands: [],
    };
    await handler.toggleExtension(ext as any);
    expect(mockToggleExtensionState).toHaveBeenCalledWith('clipboard-history', false);
    expect(ext.enabled).toBe(false);
  });

  it('toggles state for non-built-in extensions', async () => {
    const handler = new SettingsHandler();
    const ext = {
      id: 'com.example.test',
      title: 'Custom Ext',
      isBuiltIn: false,
      enabled: true,
      commands: [],
    };
    await handler.toggleExtension(ext as any);
    expect(mockToggleExtensionState).toHaveBeenCalledWith('com.example.test', false);
    expect(ext.enabled).toBe(false);
  });

  it('flips enabled before the backend resolves', async () => {
    let resolve!: (v: boolean) => void;
    mockToggleExtensionState.mockReturnValueOnce(new Promise<boolean>((r) => (resolve = r)));
    const handler = new SettingsHandler();
    const ext = {
      id: 'com.example.test',
      title: 'T',
      isBuiltIn: false,
      enabled: true,
      commands: [],
    };
    const pending = handler.toggleExtension(ext as any);
    await Promise.resolve();
    expect(ext.enabled).toBe(false);
    resolve(true);
    await pending;
    expect(ext.enabled).toBe(false);
  });

  it('rolls back and reports an error when the backend returns false', async () => {
    mockToggleExtensionState.mockResolvedValueOnce(false);
    const handler = new SettingsHandler();
    const ext = {
      id: 'com.example.test',
      title: 'T',
      isBuiltIn: false,
      enabled: true,
      commands: [],
    };
    await handler.toggleExtension(ext as any);
    expect(ext.enabled).toBe(true);
    expect(handler.saveError).toBe(true);
    expect(handler.saveMessage).toBe('Failed to update extension settings.');
  });

  it('rolls back when the backend throws', async () => {
    mockToggleExtensionState.mockRejectedValueOnce(new Error('boom'));
    const handler = new SettingsHandler();
    const ext = {
      id: 'com.example.test',
      title: 'T',
      isBuiltIn: false,
      enabled: false,
      commands: [],
    };
    await handler.toggleExtension(ext as any);
    expect(ext.enabled).toBe(false);
    expect(handler.saveError).toBe(true);
  });

  it('ignores a second toggle of the same extension while one is in flight', async () => {
    let resolve!: (v: boolean) => void;
    mockToggleExtensionState.mockReturnValueOnce(new Promise<boolean>((r) => (resolve = r)));
    const handler = new SettingsHandler();
    const ext = {
      id: 'com.example.test',
      title: 'T',
      isBuiltIn: false,
      enabled: true,
      commands: [],
    };
    const first = handler.toggleExtension(ext as any);
    await handler.toggleExtension(ext as any);
    expect(mockToggleExtensionState).toHaveBeenCalledTimes(1);
    resolve(true);
    await first;
  });
});

describe('SettingsHandler.loadExtensions background rescan', () => {
  it('does not flip isLoadingExtensions when a list is already shown', async () => {
    mockGetAll.mockResolvedValue([{ id: 'a', title: 'A', isBuiltIn: false, commands: [] }]);
    const handler = new SettingsHandler();
    await handler.loadExtensions();
    expect(handler.extensions.length).toBeGreaterThan(0);

    const seen: boolean[] = [];
    mockGetAll.mockImplementationOnce(async () => {
      seen.push(handler.isLoadingExtensions);
      return [{ id: 'a', title: 'A', isBuiltIn: false, commands: [] }];
    });
    await handler.loadExtensions();
    expect(seen).toEqual([false]);
  });
});

describe('SettingsHandler.toggleExtension focus guard', () => {
  it('re-focuses Settings if it loses focus right after a toggle', async () => {
    let cb: ((e: { payload: boolean }) => void) | undefined;
    onFocusChangedMock.mockImplementation(async (fn) => {
      cb = fn;
      return () => {};
    });
    setFocusMock.mockClear();
    const handler = new SettingsHandler();
    const ext = { id: 'com.example.t', title: 'T', isBuiltIn: false, enabled: true, commands: [] };
    await handler.toggleExtension(ext as any);
    await new Promise((r) => setTimeout(r, 0));

    cb?.({ payload: false });
    expect(setFocusMock).toHaveBeenCalledTimes(1);
    cb?.({ payload: true });
    expect(setFocusMock).toHaveBeenCalledTimes(1);
  });
});
