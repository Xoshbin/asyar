import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionContext } from 'asyar-sdk/contracts';

const mockLogService = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../log/logService', () => ({ logService: mockLogService }));
vi.mock('../search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: { items: [], handleSearch: vi.fn() },
}));
vi.mock('../search/stores/search.svelte', () => ({
  searchStores: { selectedIndex: -1, query: '' },
}));
vi.mock('../extension/commandService.svelte', () => ({
  commandService: { executeCommand: vi.fn() },
}));
vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: { showHUD: vi.fn(), confirmAlert: vi.fn().mockResolvedValue(true) },
}));
vi.mock('../application/applicationService', () => ({
  applicationService: { uninstallApplication: vi.fn(), scanUninstallTargets: vi.fn() },
}));
vi.mock('../settings/developerSettingsService.svelte', () => ({
  developerSettingsService: {
    isDeveloperMode: false,
    showInspector: false,
    verboseLogging: false,
    tracing: false,
    allowSideloading: false,
  },
}));
vi.mock('../../lib/ipc/commands', () => ({
  showSettingsWindow: vi.fn(),
  hideWindow: vi.fn(),
  resetSearchIndex: vi.fn(),
  factoryReset: vi.fn(),
}));

import { ActionService, type ApplicationAction } from './actionService.svelte';

function makeAction(execute = vi.fn(), visible?: () => boolean): ApplicationAction {
  return {
    id: 'test:idempotent',
    label: 'Stable action',
    icon: 'icon:test',
    description: 'Description',
    category: 'Tests',
    extensionId: 'tests',
    context: ActionContext.CORE,
    confirm: true,
    destructive: false,
    shortcut: 'Super+Shift+Y',
    disabled: false,
    execute,
    visible,
  };
}

describe('ActionService idempotent registration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refreshes execute in place without logging or recomputing matching metadata', async () => {
    const service = new ActionService();
    const firstExecute = vi.fn();
    const nextExecute = vi.fn();
    service.registerAction(makeAction(firstExecute));
    const registered = service.filteredActions.find((action) => action.id === 'test:idempotent');
    const updateState = vi.spyOn(service as any, 'updateState');
    mockLogService.debug.mockClear();

    service.registerAction(makeAction(nextExecute));

    expect(updateState).not.toHaveBeenCalled();
    expect(mockLogService.debug).not.toHaveBeenCalled();
    expect(service.filteredActions.find((action) => action.id === 'test:idempotent')).toBe(
      registered,
    );
    await registered?.execute();
    expect(firstExecute).not.toHaveBeenCalled();
    expect(nextExecute).toHaveBeenCalledOnce();
  });

  it('does not collapse registrations that have a visible predicate', () => {
    const service = new ActionService();
    service.registerAction(makeAction(vi.fn(), () => true));
    const updateState = vi.spyOn(service as any, 'updateState');

    service.registerAction(makeAction(vi.fn(), () => true));

    expect(updateState).toHaveBeenCalledOnce();
    expect(mockLogService.debug).toHaveBeenCalled();
  });

  it('silently ignores unregistration of an unknown action', () => {
    const service = new ActionService();
    const updateState = vi.spyOn(service as any, 'updateState');
    mockLogService.warn.mockClear();

    service.unregisterAction('missing');

    expect(updateState).not.toHaveBeenCalled();
    expect(mockLogService.warn).not.toHaveBeenCalled();
  });
});
