// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, persistedSnippetEnabled, storeGetMock, storeSetMock, updateSettingsMock } =
  vi.hoisted(() => ({
    invokeMock: vi.fn().mockResolvedValue(null),
    persistedSnippetEnabled: { value: undefined as boolean | undefined },
    storeGetMock: vi.fn(async () => undefined as boolean | undefined),
    storeSetMock: vi.fn(async () => undefined),
    updateSettingsMock: vi.fn().mockResolvedValue(true),
  }));

vi.mock('../../../components', async () => ({
  SettingsCard: (await import('../../../components/settings/SettingsCard.svelte')).default,
  SettingsRow: (await import('../../../components/settings/SettingsRow.svelte')).default,
  Toggle: (await import('../../../components/base/Toggle.svelte')).default,
  SegmentedControl: (await import('../../../components/base/SegmentedControl.svelte')).default,
}));

vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    updateSettings: updateSettingsMock,
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  transformCallback: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue({
    get: storeGetMock,
    set: storeSetMock,
    save: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../lib/ipc/commands', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/ipc/commands')>()),
  getScheduledTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../services/runtime/runtimeService.svelte', () => ({
  runtimeService: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

import AdvancedTab from './AdvancedTab.svelte';

function makeHandler(escapeInViewBehavior: 'go-back' | 'close-window' | 'hide-and-reset') {
  return {
    settings: {
      general: {
        startAtLogin: false,
        showDockIcon: false,
        showTrayIcon: true,
        escapeInViewBehavior,
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
      appearance: {
        theme: 'system' as const,
        launchView: 'default' as const,
        windowWidth: 800,
        windowHeight: 600,
      },
      extensions: { enabled: {}, autoUpdate: false },
      onboarding: { completed: true },
      updates: { channel: 'stable' as const, autoCheck: true },
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
      privacy: { crashReportMode: 'off' as const, usageShareMode: 'off' as const },
      fileSearch: { enabled: true, includeRoots: [], excludePatterns: [], indexHidden: false },
    },
    saveError: false,
    saveMessage: '',
    handleExtensionSearchToggle: vi.fn(),
    handleExtensionActionsToggle: vi.fn(),
    handleDeveloperModeToggle: vi.fn(),
    updateEscapeBehavior: vi.fn(),
  };
}

describe('AdvancedTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(null);
    persistedSnippetEnabled.value = undefined;
    storeGetMock.mockImplementation(async () => persistedSnippetEnabled.value);
    storeSetMock.mockImplementation(async (_key, value) => {
      persistedSnippetEnabled.value = value as boolean;
    });
    localStorage.clear();
  });

  it('renders Advanced settings from the handler state without throwing', () => {
    render(AdvancedTab, { handler: makeHandler('go-back') as any });

    expect(screen.getByText('Extension results in search')).toBeTruthy();
  });

  it.each([
    { current: false, expected: true },
    { current: true, expected: false },
  ])('persists auto-update $current -> $expected', async ({ current, expected }) => {
    const handler = makeHandler('go-back');
    handler.settings.extensions.autoUpdate = current;
    render(AdvancedTab, { handler: handler as any });

    const toggles = screen.getAllByRole('checkbox');
    await fireEvent.click(toggles[2]);

    expect(updateSettingsMock).toHaveBeenCalledWith('extensions', { autoUpdate: expected });
  });

  it('initializes the escape behavior control from escapeInViewBehavior', () => {
    render(AdvancedTab, { handler: makeHandler('close-window') as any });

    expect(screen.getByRole('radio', { name: 'Hide Window' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it.each([
    { initial: true, expected: false },
    { initial: false, expected: true },
  ])(
    'persists Text expansion $initial -> $expected after leaving and returning',
    async ({ initial, expected }) => {
      persistedSnippetEnabled.value = initial;
      const firstMount = render(AdvancedTab, { handler: makeHandler('go-back') as any });
      const textExpansionToggle = screen.getAllByRole('checkbox')[3] as HTMLInputElement;

      await vi.waitFor(() => expect(storeGetMock).toHaveBeenCalled());
      await vi.waitFor(() => expect(textExpansionToggle.checked).toBe(initial));
      await fireEvent.click(textExpansionToggle);
      await vi.waitFor(() => expect(textExpansionToggle.checked).toBe(expected));

      firstMount.unmount();
      render(AdvancedTab, { handler: makeHandler('go-back') as any });

      await vi.waitFor(() => {
        expect((screen.getAllByRole('checkbox')[3] as HTMLInputElement).checked).toBe(expected);
      });
    },
  );

  it('keeps the previous Text expansion state when the backend rejects the toggle', async () => {
    render(AdvancedTab, { handler: makeHandler('go-back') as any });
    const textExpansionToggle = screen.getAllByRole('checkbox')[3] as HTMLInputElement;
    await vi.waitFor(() => expect(storeGetMock).toHaveBeenCalled());
    invokeMock.mockRejectedValueOnce(new Error('listener unavailable'));

    await fireEvent.click(textExpansionToggle);

    expect(await screen.findByText('set_snippets_enabled failed')).toBeTruthy();
    expect(textExpansionToggle.checked).toBe(true);
    expect(storeSetMock).not.toHaveBeenCalled();
  });
});
