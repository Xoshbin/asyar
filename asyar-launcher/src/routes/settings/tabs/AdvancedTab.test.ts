// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const {
  invokeMock,
  listenMock,
  snippetSetEnabledMock,
  snippetLoadMock,
  snippetSaveMock,
  persistedSnippetEnabled,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(() => Promise.resolve(() => {})),
  snippetSetEnabledMock: vi.fn(),
  snippetLoadMock: vi.fn(),
  snippetSaveMock: vi.fn(),
  persistedSnippetEnabled: {
    value: undefined as boolean | undefined,
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('tauri-plugin-clipboard-x-api', () => ({
  writeText: vi.fn(),
}));

const { mockUpdateSettings } = vi.hoisted(() => ({
  mockUpdateSettings: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    init: vi.fn().mockResolvedValue(true),

    currentSettings: {
      general: {
        startAtLogin: false,
        showDockIcon: false,
        showTrayIcon: true,
        escapeInViewBehavior: 'go-back',
      },

      search: {
        searchApplications: true,
        searchSystemPreferences: true,
        fuzzySearch: true,
        enableExtensionSearch: false,
        allowExtensionActions: false,
        additionalScanPaths: [],
        applicationEnabled: {},
      },

      shortcut: {
        modifier: 'Alt',
        key: 'Space',
      },

      appearance: {
        theme: 'system',
        launchView: 'default',
        windowWidth: 800,
        windowHeight: 600,
      },

      extensions: {
        enabled: {},
        autoUpdate: true,
      },

      onboarding: {
        completed: false,
      },

      ai: {
        providers: {},
        temperature: 0.7,
        maxTokens: 2048,
        defaultAgentId: null,
        tabContinuesLastThread: false,
      },

      developer: {
        enabled: false,
        showInspector: false,
        verboseLogging: false,
        tracing: false,
        allowSideloading: false,
      },

      privacy: {
        crashReportMode: 'off',
        usageShareMode: 'off',
      },

      fileSearch: {
        enabled: true,
        includeRoots: [],
        excludePatterns: [],
        indexHidden: false,
      },
    },

    updateSettings: mockUpdateSettings,
    getSettings: vi.fn().mockReturnValue({}),
  },

  settings: {
    subscribe: vi.fn(),
  },
}));

vi.mock('../../../services/runtime/runtimeService.svelte', () => ({
  runtimeService: {
    list: vi.fn().mockResolvedValue([
      {
        name: 'python',
        version: '3.11.0',
        sizeBytes: 52428800,
      },
    ]),

    consumersOf: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../lib/ipc/commands', () => ({
  getScheduledTasks: vi.fn().mockResolvedValue([
    {
      extensionName: 'Test Extension',
      commandName: 'Sync Data',
      intervalSeconds: 3600,
      active: true,
    },
  ]),

  checkSnippetPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../built-in-features/snippets/snippetService', () => ({
  snippetService: {
    init: vi.fn().mockResolvedValue(undefined),
    setEnabled: snippetSetEnabledMock,
  },

  enabledPersistence: {
    loadSync: vi.fn((fallback = true) => persistedSnippetEnabled.value ?? fallback),

    load: snippetLoadMock,

    save: snippetSaveMock,
  },
}));

vi.mock('../../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    report: vi.fn(),
    confirmAlert: vi.fn().mockResolvedValue(true),
  },
}));

import AdvancedTab from './AdvancedTab.svelte';
import type { SettingsHandler } from '../settingsHandlers.svelte';

function createMockHandler(overrides?: Partial<SettingsHandler>): SettingsHandler {
  return {
    settings: {
      general: {
        startAtLogin: false,
        showDockIcon: false,
        showTrayIcon: true,
        escapeInViewBehavior: 'go-back',
      },

      search: {
        searchApplications: true,
        searchSystemPreferences: true,
        fuzzySearch: true,
        enableExtensionSearch: false,
        allowExtensionActions: false,
        additionalScanPaths: [],
        applicationEnabled: {},
      },

      shortcut: {
        modifier: 'Super',
        key: 'K',
      },

      appearance: {
        theme: 'system',
        launchView: 'default',
        windowWidth: 800,
        windowHeight: 600,
        activeTheme: null,
      },

      extensions: {
        enabled: {},
        autoUpdate: true,
      },

      onboarding: {
        completed: false,
      },

      feedback: {
        promptSeen: false,
      },

      updates: {
        channel: 'stable',
        autoCheck: true,
      },

      ai: {
        providers: {},
        temperature: 0.7,
        maxTokens: 2048,
        defaultAgentId: null,
        tabContinuesLastThread: false,
      },

      developer: {
        enabled: false,
        showInspector: false,
        verboseLogging: false,
        tracing: false,
        allowSideloading: false,
      },

      privacy: {
        crashReportMode: 'off',
        usageShareMode: 'off',
      },

      fileSearch: {
        enabled: true,
        includeRoots: [],
        excludePatterns: [],
        indexHidden: false,
      },
    },

    handleExtensionSearchToggle: vi.fn(),
    handleExtensionActionsToggle: vi.fn(),
    handleExtensionAutoUpdateToggle: vi.fn(),
    handleDeveloperModeToggle: vi.fn(),
    updateEscapeBehavior: vi.fn(),

    saveError: false,
    saveMessage: '',

    ...overrides,
  } as unknown as SettingsHandler;
}

describe('AdvancedTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    invokeMock.mockResolvedValue(null);

    persistedSnippetEnabled.value = undefined;

    snippetSetEnabledMock.mockResolvedValue({
      ok: true,
    });

    snippetLoadMock.mockImplementation(
      async (fallback = true) => persistedSnippetEnabled.value ?? fallback,
    );

    snippetSaveMock.mockImplementation(async (value: boolean) => {
      persistedSnippetEnabled.value = value;
    });

    localStorage.clear();
  });

  it('renders without crashing when loaded', async () => {
    const handler = createMockHandler();

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    expect(screen.getByText('Extension surface')).toBeTruthy();
    expect(screen.getByText('Input')).toBeTruthy();
    expect(screen.getByText('Extension results in search')).toBeTruthy();
    expect(screen.getByText('Extension actions in ⌘K')).toBeTruthy();
    expect(screen.getByText('Auto-update extensions')).toBeTruthy();
    expect(screen.getByText('Escape key')).toBeTruthy();
    expect(screen.getByText('Text expansion')).toBeTruthy();
    expect(screen.getByText('Developer mode')).toBeTruthy();
  });

  it('calls handleExtensionSearchToggle when toggling extension search', async () => {
    const handler = createMockHandler();

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    const checkboxes = screen.getAllByRole('checkbox');

    await fireEvent.change(checkboxes[0]);

    expect(handler.handleExtensionSearchToggle).toHaveBeenCalledTimes(1);
  });

  it('calls handleExtensionActionsToggle when toggling extension actions', async () => {
    const handler = createMockHandler();

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    const checkboxes = screen.getAllByRole('checkbox');

    await fireEvent.change(checkboxes[1]);

    expect(handler.handleExtensionActionsToggle).toHaveBeenCalledTimes(1);
  });

  it('calls handleExtensionAutoUpdateToggle when toggling auto-update', async () => {
    const handler = createMockHandler();

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    const checkboxes = screen.getAllByRole('checkbox');

    await fireEvent.change(checkboxes[2]);

    expect(handler.handleExtensionAutoUpdateToggle).toHaveBeenCalledTimes(1);
  });

  it('initializes escape behavior from escapeInViewBehavior', () => {
    const handler = createMockHandler();

    handler.settings.general.escapeInViewBehavior = 'close-window';

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    expect(
      screen
        .getByRole('radio', {
          name: 'Hide Window',
        })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('calls updateEscapeBehavior when selecting a different escape option', async () => {
    const handler = createMockHandler();

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    const resetOption = screen.getByText('Reset Launcher');

    await fireEvent.click(resetOption);

    expect(handler.updateEscapeBehavior).toHaveBeenCalledWith('hide-and-reset');
  });

  it('toggles snippet expansion service', async () => {
    persistedSnippetEnabled.value = true;

    const handler = createMockHandler();

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    const checkboxes = screen.getAllByRole('checkbox');
    const snippetsToggle = checkboxes[3] as HTMLInputElement;

    await vi.waitFor(() => {
      expect(snippetLoadMock).toHaveBeenCalled();
      expect(snippetsToggle.checked).toBe(true);
    });

    await fireEvent.click(snippetsToggle);

    expect(snippetSetEnabledMock).toHaveBeenCalledWith(false);
    expect(snippetSaveMock).toHaveBeenCalledWith(false);
  });

  it.each([
    {
      initial: true,
      expected: false,
    },
    {
      initial: false,
      expected: true,
    },
  ])(
    'persists Text expansion $initial -> $expected after leaving and returning',
    async ({ initial, expected }) => {
      persistedSnippetEnabled.value = initial;

      const handler = createMockHandler();

      const firstMount = render(AdvancedTab, {
        props: {
          handler,
        },
      });

      const textExpansionToggle = screen.getAllByRole('checkbox')[3] as HTMLInputElement;

      await vi.waitFor(() => {
        expect(snippetLoadMock).toHaveBeenCalled();
        expect(textExpansionToggle.checked).toBe(initial);
      });

      await fireEvent.click(textExpansionToggle);

      await vi.waitFor(() => {
        expect(snippetSetEnabledMock).toHaveBeenCalledWith(expected);
        expect(snippetSaveMock).toHaveBeenCalledWith(expected);
        expect(textExpansionToggle.checked).toBe(expected);
      });

      firstMount.unmount();

      render(AdvancedTab, {
        props: {
          handler: createMockHandler(),
        },
      });

      await vi.waitFor(() => {
        expect((screen.getAllByRole('checkbox')[3] as HTMLInputElement).checked).toBe(expected);
      });
    },
  );

  it('keeps the previous Text expansion state when the backend rejects the toggle', async () => {
    persistedSnippetEnabled.value = true;

    snippetSetEnabledMock.mockResolvedValueOnce({
      ok: false,
      error: 'set_snippets_enabled failed',
    });

    const handler = createMockHandler();

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    const textExpansionToggle = screen.getAllByRole('checkbox')[3] as HTMLInputElement;

    await vi.waitFor(() => {
      expect(snippetLoadMock).toHaveBeenCalled();
      expect(textExpansionToggle.checked).toBe(true);
    });

    await fireEvent.click(textExpansionToggle);

    expect(await screen.findByText('set_snippets_enabled failed')).toBeTruthy();

    expect(textExpansionToggle.checked).toBe(true);
    expect(snippetSaveMock).not.toHaveBeenCalled();
    expect(persistedSnippetEnabled.value).toBe(true);
  });

  it('calls handleDeveloperModeToggle when toggling developer mode', async () => {
    const handler = createMockHandler();

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    const checkboxes = screen.getAllByRole('checkbox');

    await fireEvent.change(checkboxes[4]);

    expect(handler.handleDeveloperModeToggle).toHaveBeenCalledTimes(1);
  });

  it('renders scheduled tasks and installed runtimes sections', async () => {
    const handler = createMockHandler();

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    await screen.findByText('Scheduled Tasks');

    expect(screen.getByText('Test Extension')).toBeTruthy();
    expect(screen.getByText('Sync Data · every 60 minutes')).toBeTruthy();

    await screen.findByText('Installed Runtimes');

    expect(screen.getByText('python')).toBeTruthy();
  });

  it('displays save error message when saveError is true', async () => {
    const handler = createMockHandler({
      saveError: true,
      saveMessage: 'Failed to update setting',
    });

    render(AdvancedTab, {
      props: {
        handler,
      },
    });

    expect(screen.getByText('Failed to update setting')).toBeTruthy();
  });
});