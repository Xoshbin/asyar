/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}));

vi.mock('../../services/run/runService.svelte', () => ({
  runService: {
    loadHistory: vi.fn().mockResolvedValue(undefined),
    selectedRunId: null,
    combined: [] as Array<{ id: string }>,
    moveSelection: vi.fn(),
  },
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
    refreshFiltered: vi.fn(),
    executeAction: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('asyar-sdk/contracts', () => ({
  ActionContext: { EXTENSION_VIEW: 'extension_view' },
}));

vi.mock('./RunView.svelte', () => ({ default: {} }));

vi.mock('../agents/runNavigation', () => ({
  openAgentRunInChat: vi.fn().mockResolvedValue(true),
}));

import RunsExtension from './index';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { runService } from '../../services/run/runService.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { openAgentRunInChat } from '../agents/runNavigation';

beforeEach(() => {
  vi.clearAllMocks();
  (runService as any).selectedRunId = null;
  (runService as any).combined = [];
});

describe('RunsExtension.executeCommand', () => {
  it('executeCommand_open_runs_calls_navigate_to_runs_RunView', async () => {
    await RunsExtension.executeCommand('open-runs');
    expect(viewManager.navigateToView).toHaveBeenCalledWith('runs/RunView');
  });

  it('executeCommand_open_runs_clears_selection_when_no_id_arg', async () => {
    (runService as any).selectedRunId = 'existing-id';
    await RunsExtension.executeCommand('open-runs');
    expect((runService as any).selectedRunId).toBeNull();
  });

  it('executeCommand_open_runs_with_id_sets_selectedRunId', async () => {
    await RunsExtension.executeCommand('open-runs', { arguments: { id: 'r1' } });
    expect((runService as any).selectedRunId).toBe('r1');
    expect(viewManager.navigateToView).toHaveBeenCalledWith('runs/RunView');
  });
});

describe('RunsExtension keyboard navigation', () => {
  it('registers the agent conversation action for the lifetime of the Runs view', async () => {
    await RunsExtension.viewActivated!('runs/RunView');

    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agents:open-run-in-chat',
        extensionId: 'runs',
      }),
    );

    await RunsExtension.viewDeactivated!('runs/RunView');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('agents:open-run-in-chat');
  });

  it('the registered conversation action opens the selected agent run', async () => {
    (runService as any).combined = [{ id: 'agent-run-1', kind: 'agent' }];
    (runService as any).selectedRunId = 'agent-run-1';
    await RunsExtension.viewActivated!('runs/RunView');

    const action = vi
      .mocked(actionService.registerAction)
      .mock.calls.map(([registered]) => registered)
      .find((registered) => registered.id === 'agents:open-run-in-chat');
    await action?.execute();

    expect(openAgentRunInChat).toHaveBeenCalledWith('agent-run-1');
    await RunsExtension.viewDeactivated!('runs/RunView');
  });

  it('ArrowDown after viewActivated invokes moveSelection("down")', async () => {
    (runService as any).combined = [{ id: 'a1' }, { id: 'a2' }];
    await RunsExtension.viewActivated!('runs/RunView');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect((runService as any).moveSelection).toHaveBeenCalledWith('down');
    await RunsExtension.viewDeactivated!('runs/RunView');
  });

  it('ArrowUp after viewActivated invokes moveSelection("up")', async () => {
    (runService as any).combined = [{ id: 'a1' }, { id: 'a2' }];
    await RunsExtension.viewActivated!('runs/RunView');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect((runService as any).moveSelection).toHaveBeenCalledWith('up');
    await RunsExtension.viewDeactivated!('runs/RunView');
  });

  it('keydown after viewDeactivated is a no-op', async () => {
    (runService as any).combined = [{ id: 'a1' }];
    await RunsExtension.viewActivated!('runs/RunView');
    await RunsExtension.viewDeactivated!('runs/RunView');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect((runService as any).moveSelection).not.toHaveBeenCalled();
  });

  it('arrow keydown with empty combined list does not call moveSelection', async () => {
    (runService as any).combined = [];
    await RunsExtension.viewActivated!('runs/RunView');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect((runService as any).moveSelection).not.toHaveBeenCalled();
    await RunsExtension.viewDeactivated!('runs/RunView');
  });

  it('non-arrow keys are ignored', async () => {
    (runService as any).combined = [{ id: 'a1' }];
    await RunsExtension.viewActivated!('runs/RunView');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect((runService as any).moveSelection).not.toHaveBeenCalled();
    expect(actionService.executeAction).not.toHaveBeenCalled();
    await RunsExtension.viewDeactivated!('runs/RunView');
  });

  it('Enter with no selection does not read the combined run list', async () => {
    const combinedGetter = vi.fn(() => []);
    Object.defineProperty(runService, 'combined', {
      configurable: true,
      get: combinedGetter,
    });

    try {
      await RunsExtension.viewActivated!('runs/RunView');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(combinedGetter).not.toHaveBeenCalled();
    } finally {
      await RunsExtension.viewDeactivated!('runs/RunView');
      Object.defineProperty(runService, 'combined', {
        configurable: true,
        writable: true,
        value: [],
      });
    }
  });

  it('Enter opens the conversation for the selected agent run', async () => {
    (runService as any).combined = [
      { id: 'agent-run-1', kind: 'agent' },
      { id: 'script-run-1', kind: 'shell-script' },
    ];
    (runService as any).selectedRunId = 'agent-run-1';
    await RunsExtension.viewActivated!('runs/RunView');

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(actionService.executeAction).toHaveBeenCalledWith('agents:open-run-in-chat');
    expect(event.defaultPrevented).toBe(true);
    await RunsExtension.viewDeactivated!('runs/RunView');
  });
});
