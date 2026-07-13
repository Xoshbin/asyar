import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  hideWindow: vi.fn(async () => {}),
  setFocusLock: vi.fn(async () => {}),
  systemActionRun: vi.fn(async () => true),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(() => 'windows'),
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { confirmAlert: vi.fn(async () => true) },
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as commands from '../../lib/ipc/commands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { logService } from '../../services/log/logService';
import { dispatchSystemCommand } from './dispatch';

describe('dispatchSystemCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('non-destructive action runs without confirmation, hiding the window first', async () => {
    await dispatchSystemCommand('sleep');

    expect(feedbackService.confirmAlert).not.toHaveBeenCalled();
    expect(commands.hideWindow).toHaveBeenCalledTimes(1);
    expect(commands.systemActionRun).toHaveBeenCalledWith('sleep');
    expect(vi.mocked(commands.hideWindow).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(commands.systemActionRun).mock.invocationCallOrder[0],
    );
  });

  it('destructive action asks for confirmation under focus lock', async () => {
    await dispatchSystemCommand('shutDown');

    expect(commands.setFocusLock).toHaveBeenNthCalledWith(1, true);
    expect(feedbackService.confirmAlert).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'danger', confirmText: 'Shut Down' }),
    );
    expect(commands.setFocusLock).toHaveBeenNthCalledWith(2, false);
    expect(commands.systemActionRun).toHaveBeenCalledWith('shutDown');
  });

  it('cancelling the confirmation runs nothing and releases the focus lock', async () => {
    vi.mocked(feedbackService.confirmAlert).mockResolvedValueOnce(false);

    await dispatchSystemCommand('restart');

    expect(commands.systemActionRun).not.toHaveBeenCalled();
    expect(commands.hideWindow).not.toHaveBeenCalled();
    expect(commands.setFocusLock).toHaveBeenLastCalledWith(false);
  });

  it('unknown dynamic id warns and does nothing', async () => {
    await dispatchSystemCommand('not-a-real-action');

    expect(logService.warn).toHaveBeenCalled();
    expect(commands.systemActionRun).not.toHaveBeenCalled();
  });
});
