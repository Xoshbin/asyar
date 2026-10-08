import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  hideWindow: vi.fn(async () => {}),
  openUrl: vi.fn(async () => {}),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as commands from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import { dispatchSettingsPaneCommand } from './dispatch';

describe('dispatchSettingsPaneCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the launcher then deep-links into the pane', async () => {
    await dispatchSettingsPaneCommand('sound');

    expect(commands.hideWindow).toHaveBeenCalledTimes(1);
    expect(commands.openUrl).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.Sound-Settings.extension',
    );
    expect(vi.mocked(commands.hideWindow).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(commands.openUrl).mock.invocationCallOrder[0],
    );
  });

  it('warns and does nothing for an unknown pane', async () => {
    await dispatchSettingsPaneCommand('nope');

    expect(commands.hideWindow).not.toHaveBeenCalled();
    expect(commands.openUrl).not.toHaveBeenCalled();
    expect(logService.warn).toHaveBeenCalled();
  });
});
