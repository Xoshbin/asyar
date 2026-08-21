/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionService } from '../actionService.svelte';
import { ExtensionLoader } from '../../extension/ExtensionLoader';
import { ActionContext } from 'asyar-sdk/contracts';

// ---------- Hoisted Mocks ----------

const mockSearchOrchestrator = vi.hoisted(() => ({ items: [] as any[] }));
vi.mock('../../search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: mockSearchOrchestrator,
}));

const mockSearchStores = vi.hoisted(() => ({ selectedIndex: -1, query: '' }));
vi.mock('../../search/stores/search.svelte', () => ({
  searchStores: mockSearchStores,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/ipc/commands', () => ({
  showSettingsWindow: vi.fn().mockResolvedValue(undefined),
  factoryReset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('tauri-plugin-clipboard-x-api', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
}));

vi.mock('../../settings/developerSettingsService.svelte', () => ({
  developerSettingsService: { isDeveloperMode: true },
}));

vi.mock('../../settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn().mockReturnValue({ search: { allowExtensionActions: true } }),
    isInitialized: vi.fn().mockReturnValue(true),
    isExtensionEnabled: vi.fn().mockReturnValue(true),
  },
}));

describe('Action & Shortcut Registry Integrity Guard', () => {
  let actionService: ActionService;

  beforeEach(() => {
    mockSearchStores.selectedIndex = -1;
    mockSearchStores.query = '';
    mockSearchOrchestrator.items = [];
    actionService = new ActionService();
  });

  it('all built-in action IDs are unique', () => {
    const actions = actionService.getAllActions();
    const ids = actions.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('all built-in action shortcuts are unique and well-formed', () => {
    const actions = actionService.getAllActions();
    const shortcuts = actions.map((a) => a.shortcut).filter(Boolean) as string[];
    const uniqueShortcuts = new Set(shortcuts);

    expect(shortcuts.length).toBe(uniqueShortcuts.size);

    for (const shortcut of shortcuts) {
      expect(shortcut).toMatch(/^(Super|Ctrl|Alt|Shift)(\+[A-Za-z0-9,]+)+$/);
    }
  });

  it('never produces duplicate UI action labels or conflicting extension settings actions when an extension command is highlighted', () => {
    // 1. Setup sample extension manifest with commands, preferences, and custom command actions
    const sampleManifest = {
      id: 'org.asyar.sample-extension',
      name: 'Sample Extension',
      version: '1.0.0',
      title: 'Sample Extension',
      preferences: [{ name: 'token', type: 'password', title: 'API Token' }],
    };

    const sampleCmd = {
      id: 'sample-cmd',
      name: 'Sample Command',
      title: 'Sample Command',
      mode: 'view',
      actions: [
        {
          id: 'copy-custom',
          title: 'Copy Custom Payload',
          description: 'Copy custom payload',
          icon: 'icon:copy',
          shortcut: 'Super+Shift+X',
        },
      ],
    };

    // 2. Mock loader commands
    const loader = new ExtensionLoader({} as any, vi.fn(), vi.fn(), vi.fn());
    (loader as any).allLoadedCommands = [
      { cmd: sampleCmd, manifest: sampleManifest, isBuiltIn: false },
    ];
    (loader as any).manifestMap = new Map([[sampleManifest.id, sampleManifest]]);

    // 3. Register extension actions into the real actionService instance
    // Temporarily replace module actionService registration for this loader
    for (const action of (loader as any).allLoadedCommands[0].cmd.actions) {
      actionService.registerAction({
        id: `act_${sampleManifest.id}_${action.id}`,
        label: action.title,
        description: action.description,
        icon: action.icon,
        shortcut: action.shortcut,
        extensionId: sampleManifest.id,
        context: ActionContext.CORE,
        visible: () => {
          const idx = mockSearchStores.selectedIndex;
          if (idx < 0) return false;
          const item = mockSearchOrchestrator.items[idx];
          return (
            item?.type === 'command' &&
            item.extensionId === sampleManifest.id &&
            item.objectId === `cmd_${sampleManifest.id}_${sampleCmd.id}`
          );
        },
        execute: vi.fn(),
      });
    }

    // 4. Highlight the extension command in search
    mockSearchStores.selectedIndex = 0;
    mockSearchOrchestrator.items = [
      {
        type: 'command',
        extensionId: sampleManifest.id,
        objectId: `cmd_${sampleManifest.id}_${sampleCmd.id}`,
        name: sampleCmd.name,
      },
    ];

    actionService.refreshFiltered();

    const visibleActions = actionService.filteredActions;
    const labels = visibleActions.map((a) => a.label);
    const uniqueLabels = new Set(labels);

    // Mechanical assertion: every visible action label must be completely unique
    expect(labels.length).toBe(uniqueLabels.size);

    // Mechanical assertion: exactly one extension-level configuration action exists
    // (no duplicate 'Extension Preferences' vs 'Configure Extension Settings')
    const extensionConfigActions = visibleActions.filter(
      (a) =>
        a.id === 'configure_extension' ||
        (a.id.includes('preference') && a.category === 'Preferences'),
    );
    expect(extensionConfigActions.length).toBe(1);
    expect(extensionConfigActions[0].id).toBe('configure_extension');
  });
});
