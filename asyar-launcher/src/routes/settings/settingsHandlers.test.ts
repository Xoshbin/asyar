import { SettingsHandler } from './settingsHandlers.svelte';

const { mockGetAll } = vi.hoisted(() => ({ mockGetAll: vi.fn() }));

vi.mock('../../services/extension/extensionManager.svelte', () => ({
  default: { getAllExtensionsWithState: mockGetAll },
}));
vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: { init: vi.fn().mockResolvedValue(true), currentSettings: {}, updateSettings: vi.fn() },
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
        type: 'view',
        commands: [
          { id: 'cmd1', name: 'Start Timer', description: 'Starts the timer', trigger: 'pomo start' },
        ],
      },
    ]);

    const handler = new SettingsHandler();
    await handler.loadExtensions();

    expect(handler.extensions).toHaveLength(1);
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

    expect(handler.extensions).toHaveLength(2);
    const titles = handler.extensions.map((e) => e.title).sort();
    expect(titles).toEqual(['Calculator', 'GitHub']);
  });

  it('deduplicates by id across repeated entries', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'calculator', isBuiltIn: true, title: 'Calculator', enabled: true, commands: [] },
      { id: 'calculator', isBuiltIn: true, title: 'Calculator', enabled: true, commands: [] },
    ]);

    const handler = new SettingsHandler();
    await handler.loadExtensions();

    expect(handler.extensions).toHaveLength(1);
  });
});
