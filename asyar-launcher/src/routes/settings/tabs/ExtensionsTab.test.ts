// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

const { openStore, openCreateExtensionWithAi, openCreateExtension, showOpenExtensionDialog } =
  vi.hoisted(() => ({
    openStore: vi.fn().mockResolvedValue(undefined),
    openCreateExtensionWithAi: vi.fn().mockResolvedValue(undefined),
    openCreateExtension: vi.fn().mockResolvedValue(undefined),
    showOpenExtensionDialog: vi.fn().mockResolvedValue(null),
  }));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/ipc/commands', () => ({
  showOpenExtensionDialog,
  installExtensionFromFile: vi.fn().mockResolvedValue(undefined),
  openStore,
  openCreateExtensionWithAi,
  openCreateExtension,
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

import ExtensionsTab from './ExtensionsTab.svelte';
import type { SettingsHandler } from '../settingsHandlers.svelte';

function createHandler(): SettingsHandler {
  return {
    extensions: [],
    isLoadingExtensions: false,
    extensionError: '',
    pendingExtensionSelection: null,
    togglingExtension: null,
    preferencesVersion: 0,
    loadExtensions: vi.fn(),
    toggleExtension: vi.fn(),
    requestUninstallExtension: vi.fn(),
  } as unknown as SettingsHandler;
}

async function openAddMenu(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Add extension' }));
}

describe('ExtensionsTab add menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows all store, sideload, and creation actions when developer mode is off', async () => {
    render(ExtensionsTab, { props: { handler: createHandler() } });

    await openAddMenu();

    for (const name of [
      'Browse Store…',
      'Install from File…',
      'Build Extension with AI…',
      'Create Extension…',
    ]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it.each([
    ['Browse Store…', openStore],
    ['Build Extension with AI…', openCreateExtensionWithAi],
    ['Create Extension…', openCreateExtension],
  ])('runs %s and closes the menu', async (name, action) => {
    render(ExtensionsTab, { props: { handler: createHandler() } });
    await openAddMenu();

    await fireEvent.click(screen.getByRole('button', { name }));

    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('starts file installation and closes the menu', async () => {
    render(ExtensionsTab, { props: { handler: createHandler() } });
    await openAddMenu();

    await fireEvent.click(screen.getByRole('button', { name: 'Install from File…' }));

    expect(showOpenExtensionDialog).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Install from File…' })).toBeNull();
  });
});
