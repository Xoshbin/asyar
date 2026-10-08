import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  replaceDynamicCommandsBuiltin: vi.fn(async () => {}),
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
import { registerSettingsPaneCommands, unregisterSettingsPaneCommands } from './manager';
import { SETTINGS_PANES } from './panes';

describe('system settings pane registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform).mockReturnValue('macos');
  });

  it('registers one dynamic command per pane on macOS', async () => {
    await registerSettingsPaneCommands();

    const [extId, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect(extId).toBe('system-settings');
    expect(regs.map((r) => r.id)).toEqual(SETTINGS_PANES.map((p) => p.id));
    expect(regs.find((r) => r.id === 'sound')?.name).toBe('Sound');
    expect(regs.every((r) => r.name.length > 0 && r.icon?.startsWith('icon:'))).toBe(true);
  });

  it('registers nothing off macOS', async () => {
    vi.mocked(platform).mockReturnValue('windows');

    await registerSettingsPaneCommands();

    expect(commands.replaceDynamicCommandsBuiltin).toHaveBeenCalledWith('system-settings', []);
  });

  it('logs instead of throwing when registration fails', async () => {
    vi.mocked(commands.replaceDynamicCommandsBuiltin).mockRejectedValueOnce(new Error('boom'));

    await expect(registerSettingsPaneCommands()).resolves.toBeUndefined();
    expect(logService.error).toHaveBeenCalled();
  });

  it('clears the dynamic commands on unregister', async () => {
    await unregisterSettingsPaneCommands();

    expect(commands.replaceDynamicCommandsBuiltin).toHaveBeenCalledWith('system-settings', []);
  });
});

describe('settings pane table', () => {
  it('has unique ids valid as dynamic command ids', () => {
    const ids = SETTINGS_PANES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-zA-Z0-9_-]+$/.test(id))).toBe(true);
  });
});
