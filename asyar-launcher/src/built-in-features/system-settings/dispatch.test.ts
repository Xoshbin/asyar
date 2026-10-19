import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  hideWindow: vi.fn(async () => {}),
  showWindow: vi.fn(async () => {}),
  openSettingsPane: vi.fn(async () => true),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(() => 'macos'),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { platform } from '@tauri-apps/plugin-os';
import * as commands from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import { dispatchSettingsPaneCommand } from './dispatch';

describe('dispatchSettingsPaneCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform).mockReturnValue('macos');
  });

  it('hides the launcher then opens the pane by bundle id', async () => {
    const result = await dispatchSettingsPaneCommand('sound');

    expect(result).toBeUndefined();
    expect(commands.hideWindow).toHaveBeenCalledTimes(1);
    expect(commands.openSettingsPane).toHaveBeenCalledWith('com.apple.Sound-Settings.extension');
    expect(vi.mocked(commands.hideWindow).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(commands.openSettingsPane).mock.invocationCallOrder[0],
    );
    expect(commands.showWindow).not.toHaveBeenCalled();
  });

  it('restores the launcher when the pane does not open', async () => {
    vi.mocked(commands.openSettingsPane).mockResolvedValueOnce(false);

    const result = await dispatchSettingsPaneCommand('sound');

    expect(commands.showWindow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ type: 'keep-open' });
  });

  it('restores the launcher when the open command throws', async () => {
    vi.mocked(commands.openSettingsPane).mockRejectedValueOnce(new Error('ipc down'));

    await expect(dispatchSettingsPaneCommand('sound')).rejects.toThrow('ipc down');
    expect(commands.showWindow).toHaveBeenCalledTimes(1);
  });

  it('warns and does nothing for an unknown pane', async () => {
    await dispatchSettingsPaneCommand('nope');

    expect(commands.hideWindow).not.toHaveBeenCalled();
    expect(commands.openSettingsPane).not.toHaveBeenCalled();
    expect(logService.warn).toHaveBeenCalled();
  });

  it('does nothing off macOS, where no pane table exists yet', async () => {
    vi.mocked(platform).mockReturnValue('windows');

    await dispatchSettingsPaneCommand('sound');

    expect(commands.hideWindow).not.toHaveBeenCalled();
    expect(commands.openSettingsPane).not.toHaveBeenCalled();
  });
});
