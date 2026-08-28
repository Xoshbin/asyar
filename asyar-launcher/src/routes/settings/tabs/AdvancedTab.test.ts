// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn() }));

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
      shortcut: { modifier: 'Alt', key: 'Space' },
      appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
      extensions: { enabled: {}, autoUpdate: true },
      onboarding: { completed: false },
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
      privacy: { crashReportMode: 'off', usageShareMode: 'off' },
      fileSearch: { enabled: true, includeRoots: [], excludePatterns: [], indexHidden: false },
    },
    updateSettings: mockUpdateSettings,
    getSettings: vi.fn().mockReturnValue({}),
  },
  settings: { subscribe: vi.fn() },
}));

vi.mock('../../../services/runtime/runtimeService.svelte', () => ({
  runtimeService: {
    list: vi.fn().mockResolvedValue([{ name: 'python', version: '3.11.0', sizeBytes: 52428800 }]),
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
    setEnabled: vi.fn().mockResolvedValue(undefined),
  },
  enabledPersistence: {
    loadSync: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(true),
    save: vi.fn().mockResolvedValue(undefined),
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
import { snippetService } from '../../../built-in-features/snippets/snippetService';

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
      shortcut: { modifier: 'Super', key: 'K' },
      appearance: {
        theme: 'system',
        launchView: 'default',
        windowWidth: 800,
        windowHeight: 600,
        activeTheme: null,
      },
      extensions: { enabled: {}, autoUpdate: true },
      onboarding: { completed: false },
      feedback: { promptSeen: false },
      updates: { channel: 'stable', autoCheck: true },
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
      privacy: { crashReportMode: 'off', usageShareMode: 'off' },
      fileSearch: { enabled: true, includeRoots: [], excludePatterns: [], indexHidden: false },
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
  });

  it('renders without crashing when loaded', async () => {
    const handler = createMockHandler();
    render(AdvancedTab, { props: { handler } });

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
    render(AdvancedTab, { props: { handler } });

    const checkboxes = screen.getAllByRole('checkbox');
    await fireEvent.change(checkboxes[0]);
    expect(handler.handleExtensionSearchToggle).toHaveBeenCalledTimes(1);
  });

  it('calls handleExtensionActionsToggle when toggling extension actions', async () => {
    const handler = createMockHandler();
    render(AdvancedTab, { props: { handler } });

    const checkboxes = screen.getAllByRole('checkbox');
    await fireEvent.change(checkboxes[1]);
    expect(handler.handleExtensionActionsToggle).toHaveBeenCalledTimes(1);
  });

  it('calls handleExtensionAutoUpdateToggle when toggling auto-update', async () => {
    const handler = createMockHandler();
    render(AdvancedTab, { props: { handler } });

    const checkboxes = screen.getAllByRole('checkbox');
    await fireEvent.change(checkboxes[2]);
    expect(handler.handleExtensionAutoUpdateToggle).toHaveBeenCalledTimes(1);
  });

  it('calls updateEscapeBehavior when selecting a different escape option', async () => {
    const handler = createMockHandler();
    render(AdvancedTab, { props: { handler } });

    const resetOption = screen.getByText('Reset Launcher');
    await fireEvent.click(resetOption);
    expect(handler.updateEscapeBehavior).toHaveBeenCalledWith('hide-and-reset');
  });

  it('toggles snippet expansion service', async () => {
    const handler = createMockHandler();
    render(AdvancedTab, { props: { handler } });

    const checkboxes = screen.getAllByRole('checkbox');
    // Checkbox index: 0 = ext search, 1 = ext actions, 2 = auto-update, 3 = snippets, 4 = dev mode
    await fireEvent.change(checkboxes[3]);
    expect(snippetService.setEnabled).toHaveBeenCalledWith(false);
  });

  it('calls handleDeveloperModeToggle when toggling developer mode', async () => {
    const handler = createMockHandler();
    render(AdvancedTab, { props: { handler } });

    const checkboxes = screen.getAllByRole('checkbox');
    await fireEvent.change(checkboxes[4]);
    expect(handler.handleDeveloperModeToggle).toHaveBeenCalledTimes(1);
  });

  it('renders scheduled tasks and installed runtimes sections', async () => {
    const handler = createMockHandler();
    render(AdvancedTab, { props: { handler } });

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
    render(AdvancedTab, { props: { handler } });

    expect(screen.getByText('Failed to update setting')).toBeTruthy();
  });
});
