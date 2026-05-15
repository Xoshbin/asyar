/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}));

vi.mock('../../services/run/runService.svelte', () => ({
  runService: {
    loadHistory: vi.fn(),
    selectedRunId: null,
    combined: [] as Array<{ id: string }>,
    moveSelection: vi.fn(),
  },
}));

vi.mock('./RunView.svelte', () => ({ default: {} }));

import RunsExtension from './index';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { runService } from '../../services/run/runService.svelte';

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
    await RunsExtension.viewDeactivated!('runs/RunView');
  });
});
