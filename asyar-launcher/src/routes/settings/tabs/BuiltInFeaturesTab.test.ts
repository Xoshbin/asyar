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

// Heavy feature panels are covered by their own tests: stub them here.
vi.mock('./AiTab.svelte', async () => await import('./__stubs__/Stub.svelte'));
vi.mock('./ApplicationsTab.svelte', async () => await import('./__stubs__/Stub.svelte'));
vi.mock('./FileSearchTab.svelte', async () => await import('./__stubs__/Stub.svelte'));
vi.mock('./BrowsersTab.svelte', async () => await import('./__stubs__/Stub.svelte'));
vi.mock('./ScriptsTab.svelte', async () => await import('./__stubs__/Stub.svelte'));
vi.mock(
  '../../../components/settings/ClipboardPrivacySection.svelte',
  async () => await import('./__stubs__/Stub.svelte'),
);

vi.mock('../../../built-in-features/snippets/snippetService', () => ({
  snippetService: { setEnabled: vi.fn().mockResolvedValue(undefined) },
  enabledPersistence: { loadSync: vi.fn().mockReturnValue(true) },
}));

import BuiltInFeaturesTab from './BuiltInFeaturesTab.svelte';
import type { SettingsHandler } from '../settingsHandlers.svelte';

const builtIn = (id: string, title: string) => ({
  id,
  title,
  type: 'extension',
  isBuiltIn: true,
  disableable: true,
  enabled: true,
});
const features = [
  builtIn('built-in-notes', 'Notes'),
  builtIn('snippets', 'Snippets'),
  builtIn('agents', 'AI'),
];
const storeExt = { id: 'org.x.store', title: 'Store Ext', type: 'extension', isBuiltIn: false };

function createHandler(extensions: unknown[] = [...features, storeExt]): SettingsHandler {
  return {
    settings: {},
    extensions,
    isLoadingExtensions: false,
    extensionError: '',
    pendingExtensionSelection: null,
    tabResetCounter: 0,
    togglingExtension: null,
    preferencesVersion: 0,
    loadExtensions: vi.fn(),
    toggleExtension: vi.fn(),
    requestUninstallExtension: vi.fn(),
  } as unknown as SettingsHandler;
}

describe('BuiltInFeaturesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists built-in features only', () => {
    render(BuiltInFeaturesTab, { props: { handler: createHandler() } });
    expect(screen.getByText('Notes')).toBeTruthy();
    expect(screen.getByText('Snippets')).toBeTruthy();
    expect(screen.queryByText('Store Ext')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add extension' })).toBeNull();
  });

  it('drills into a feature with no own panel, shows the detail only, and goes back', async () => {
    render(BuiltInFeaturesTab, { props: { handler: createHandler() } });
    await fireEvent.click(screen.getByText('Notes'));
    expect(screen.getByRole('button', { name: 'settings.nav.back' })).toBeTruthy();
    expect(screen.queryByTestId('panel-stub')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'settings.nav.back' }));
    expect(screen.getByText('Snippets')).toBeTruthy();
  });

  it('renders the Text Expansion card under the Snippets detail panel', async () => {
    render(BuiltInFeaturesTab, { props: { handler: createHandler() } });
    await fireEvent.click(screen.getByText('Snippets'));
    expect(await screen.findByText('settings.advanced.text_expansion')).toBeTruthy();
  });

  it('renders the feature settings component for AI', async () => {
    render(BuiltInFeaturesTab, { props: { handler: createHandler() } });
    await fireEvent.click(screen.getByText('AI'));
    expect(await screen.findByTestId('panel-stub')).toBeTruthy();
  });

  it('a pending built-in id drills straight in after load and is consumed', async () => {
    const handler = createHandler();
    handler.pendingExtensionSelection = 'agents';
    render(BuiltInFeaturesTab, { props: { handler } });
    expect(await screen.findByTestId('panel-stub')).toBeTruthy();
    expect(handler.pendingExtensionSelection).toBeNull();
  });

  it('an unknown or non-built-in pending id leaves the list showing and clears it', () => {
    const handler = createHandler();
    handler.pendingExtensionSelection = 'org.x.store';
    render(BuiltInFeaturesTab, { props: { handler } });
    expect(screen.getByText('Notes')).toBeTruthy();
    expect(handler.pendingExtensionSelection).toBeNull();
  });

  it('shows an Always on badge instead of a toggle for non-disableable features', () => {
    const core = { ...builtIn('built-in-core', 'Core'), disableable: false };
    render(BuiltInFeaturesTab, { props: { handler: createHandler([core]) } });
    expect(screen.getByText('settings.extensions.always_on')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows a subtitle and command count on the row', () => {
    const rich = {
      ...builtIn('built-in-rich', 'Rich'),
      subtitle: 'Does rich things',
      commands: [{ id: 'a', name: 'A' }],
    };
    render(BuiltInFeaturesTab, { props: { handler: createHandler([rich]) } });
    expect(screen.getByText('Does rich things')).toBeTruthy();
    expect(screen.getByText(/settings\.extensions\.command_singular/)).toBeTruthy();
  });

  it('renders the feature settings above the Commands card when drilled in', async () => {
    const ai = {
      ...builtIn('agents', 'AI'),
      commands: [{ id: 'ask', name: 'Ask AI', trigger: 'ai' }],
    };
    render(BuiltInFeaturesTab, { props: { handler: createHandler([ai]) } });
    await fireEvent.click(screen.getByText('AI'));
    const panel = await screen.findByTestId('panel-stub');
    const commands = screen.getByText('settings.extensions.section_commands');
    expect(panel.compareDocumentPosition(commands) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ['file-search', 'File Search'],
    ['scripts', 'Scripts'],
    ['clipboard-history', 'Clipboard History'],
    ['agents', 'AI'],
    ['browsers', 'Browsers'],
  ])('renders the settings panel for the real manifest id %s', async (id, title) => {
    render(BuiltInFeaturesTab, {
      props: { handler: createHandler([builtIn(id, title)]) },
    });
    await fireEvent.click(screen.getByText(title));
    expect(await screen.findByTestId('panel-stub')).toBeTruthy();
  });

  it('returns to the list when the active sidebar tab is clicked again', async () => {
    const handler = createHandler();
    const { rerender } = render(BuiltInFeaturesTab, { props: { handler } });
    await fireEvent.click(screen.getByText('Notes'));
    expect(screen.getByRole('button', { name: 'settings.nav.back' })).toBeTruthy();

    await rerender({ handler: { ...handler, tabResetCounter: 1 } as unknown as SettingsHandler });
    expect(screen.queryByRole('button', { name: 'settings.nav.back' })).toBeNull();
    expect(screen.getByText('Snippets')).toBeTruthy();
  });
});
