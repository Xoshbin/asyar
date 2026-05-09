import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}));

vi.mock('../../services/run/runService.svelte', () => ({
  runService: {
    loadHistory: vi.fn(),
    selectedRunId: null,
  },
}));

vi.mock('./RunView.svelte', () => ({ default: {} }));

import RunsExtension from './index';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { runService } from '../../services/run/runService.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  (runService as any).selectedRunId = null;
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
