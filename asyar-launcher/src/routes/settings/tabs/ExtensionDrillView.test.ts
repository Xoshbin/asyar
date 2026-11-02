// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/ipc/commands', () => ({
  checkExtensionConsent: vi.fn().mockResolvedValue({ needsConsent: false, declaredRuntimes: [] }),
}));

vi.mock('../../../services/i18n', () => ({
  t: (key: string) =>
    ({
      'settings.extensions.add_extension': 'Add extension',
      'settings.extensions.browse_store': 'Browse Store…',
      'settings.extensions.install_from_file': 'Install from File…',
      'settings.extensions.create_with_ai': 'Build Extension with AI…',
      'settings.extensions.create_extension': 'Create Extension…',
      'settings.extensions.section_create': 'Create',
      'settings.extensions.filter_extensions': 'Extensions',
      'settings.extensions.filter_all': 'All',
      'settings.extensions.filter_commands': 'Commands',
      'settings.extensions.filter_theme': 'Theme',
      'settings.extensions.search_placeholder': 'Search…',
      'settings.extensions.table_name': 'Name',
      'settings.extensions.table_type': 'Type',
      'settings.extensions.table_alias': 'Alias',
      'settings.extensions.table_hotkey': 'Hotkey',
      'settings.extensions.table_enabled': 'Enabled',
      'settings.extensions.no_extensions': 'No extensions installed',
      'settings.extensions.no_extensions_description': 'Extensions add new functionality',
      'settings.extensions.select_extension_or_command': 'Select an extension or command',
    })[key] ?? key,
}));

vi.mock('../../../services/extension/extensionUpdateService.svelte', () => ({
  extensionUpdateService: {
    updateCount: 0,
    isUpdatingAll: false,
    getUpdateForExtension: vi.fn(),
    updateSingle: vi.fn(),
    updateAll: vi.fn(),
  },
}));

vi.mock('../../../services/extension/extensionStateManager.svelte', () => ({
  extensionStateManager: { extensionUninstallInProgress: null },
}));

vi.mock('../../../built-in-features/aliases/aliasStore.svelte', () => ({
  aliasStore: {
    list: [],
    byObjectId: new Map(),
    refresh: vi.fn().mockResolvedValue(undefined),
    removeOptimistic: vi.fn(),
  },
}));

vi.mock('../../../built-in-features/aliases/aliasService', () => ({
  aliasService: { unregister: vi.fn() },
}));

vi.mock('../../../built-in-features/shortcuts/shortcutStore.svelte', () => ({
  shortcutStore: { shortcuts: [] },
}));

vi.mock('../../../built-in-features/shortcuts/shortcutService', () => ({
  shortcutService: { register: vi.fn(), unregister: vi.fn() },
}));

vi.mock('../../../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../services/settings/developerSettingsService.svelte', () => ({
  developerSettingsService: { allowSideloading: false },
}));

import ExtensionDrillView from './ExtensionDrillView.svelte';
import type { SettingsHandler } from '../settingsHandlers.svelte';

const handler = {
  togglingExtension: null,
  preferencesVersion: 0,
  toggleExtension: vi.fn(),
  requestUninstallExtension: vi.fn(),
} as unknown as SettingsHandler;

const commands = [
  { id: 'open', name: 'Open History', trigger: 'open' },
  { id: 'clear', name: 'Clear History', trigger: 'clear' },
];

function renderDrill(extension: Record<string, unknown>, props: Record<string, unknown> = {}) {
  return render(ExtensionDrillView, {
    props: {
      handler,
      extension: extension as never,
      parentLabel: 'Built-in Features',
      canBack: true,
      canForward: false,
      onback: vi.fn(),
      onforward: vi.fn(),
      ...props,
    },
  });
}

describe('ExtensionDrillView commands', () => {
  const clipboard = {
    id: 'built-in-clipboard-history',
    title: 'Clipboard History',
    isBuiltIn: true,
    commands,
  };

  it('lists the commands of the drilled feature', () => {
    renderDrill(clipboard);
    expect(screen.getByText('Open History')).toBeTruthy();
    expect(screen.getByText('Clear History')).toBeTruthy();
    expect(screen.getAllByText('settings.extensions.add_alias')).toHaveLength(2);
    expect(screen.getAllByText('settings.extensions.record_hotkey')).toHaveLength(2);
  });

  it('omits the commands card for a feature without commands', () => {
    renderDrill({ ...clipboard, commands: [] });
    expect(screen.queryByText('settings.extensions.section_commands')).toBeNull();
  });

  it('omits the commands card for Applications, which renders its own table', () => {
    renderDrill({ ...clipboard, id: 'built-in-applications', title: 'Applications' });
    expect(screen.queryByText('Open History')).toBeNull();
  });

  it('omits the commands card when drilled into a single command', () => {
    renderDrill(clipboard, { commandId: 'open' });
    expect(screen.queryByText('settings.extensions.section_commands')).toBeNull();
  });

  it('reports the command picked from the list', async () => {
    const oncommandselect = vi.fn();
    renderDrill(clipboard, { oncommandselect });
    await fireEvent.click(screen.getByText('Clear History'));
    expect(oncommandselect).toHaveBeenCalledWith(expect.objectContaining({ id: 'clear' }));
  });
});
