/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: { registerAction: vi.fn(), unregisterAction: vi.fn(), setActionExecutor: vi.fn() },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

import extension from './index';
import { helpViewState } from './helpState.svelte';
import { GUIDE_BASE_URL, guideUrl } from './topics';

function mockContext() {
  return {
    getService: vi.fn((name: string) => {
      if (name === 'log') return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
      if (name === 'extensions') return { navigateToView: vi.fn(), setActiveViewActionLabel: vi.fn() };
      return null;
    }),
  };
}

describe('HelpExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpViewState.reset();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens the help view on the show-help command', async () => {
    await extension.initialize(mockContext() as any);
    const result = await extension.executeCommand('show-help');
    expect(result.type).toBe('view');
    expect(result.viewPath).toBe('help/DefaultView');
  });

  it('updates view state on search', async () => {
    await extension.initialize(mockContext() as any);
    await extension.onViewSearch('clip');
    expect(helpViewState.query).toBe('clip');
    expect(helpViewState.filtered.some((t) => t.id === 'clipboard-history')).toBe(true);
  });

  it('registers and unregisters the Open User Guide action around the view', async () => {
    const { actionService } = await import('../../services/action/actionService.svelte');
    await extension.initialize(mockContext() as any);
    await extension.viewActivated('help/DefaultView');
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'help:open-user-guide' }),
    );
    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    await extension.viewDeactivated('help/DefaultView');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('help:open-user-guide');
    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('Open User Guide action opens the guide base URL', async () => {
    const { actionService } = await import('../../services/action/actionService.svelte');
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await extension.initialize(mockContext() as any);
    await extension.viewActivated('help/DefaultView');
    const registerCalls = vi.mocked(actionService.registerAction).mock.calls;
    const action = registerCalls.map((c) => c[0]).find((a) => a.id === 'help:open-user-guide');
    await action!.execute();
    expect(openUrl).toHaveBeenCalledWith(GUIDE_BASE_URL);
  });

  it('opens the selected topic guide page on the primary action', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await extension.initialize(mockContext() as any);
    await extension.viewActivated('help/DefaultView');
    helpViewState.setSearch('calc'); // selects calculator
    await extension.openSelectedTopic();
    expect(openUrl).toHaveBeenCalledWith(guideUrl('features/calculator'));
  });
});
