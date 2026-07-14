import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  systemActionsSupported: vi.fn(async () => []),
  replaceDynamicCommandsBuiltin: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(() => 'windows'),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { platform } from '@tauri-apps/plugin-os';
import * as commands from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import { registerSystemCommands, unregisterSystemCommands } from './manager';

describe('system command registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform).mockReturnValue('windows');
  });

  it('registers one dynamic command per supported action, in backend order', async () => {
    vi.mocked(commands.systemActionsSupported).mockResolvedValue([
      'sleep',
      'hibernate',
      'lockScreen',
      'logOut',
      'restart',
      'shutDown',
    ]);

    await registerSystemCommands();

    expect(commands.replaceDynamicCommandsBuiltin).toHaveBeenCalledTimes(1);
    const [extId, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect(extId).toBe('system');
    expect(regs.map((r) => r.id)).toEqual([
      'sleep',
      'hibernate',
      'lockScreen',
      'logOut',
      'restart',
      'shutDown',
    ]);
    expect(regs.every((r) => r.name.length > 0 && r.icon?.startsWith('icon:'))).toBe(true);
  });

  it('omits actions the machine does not support', async () => {
    vi.mocked(commands.systemActionsSupported).mockResolvedValue(['sleep', 'lockScreen']);

    await registerSystemCommands();

    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect(regs.map((r) => r.id)).toEqual(['sleep', 'lockScreen']);
  });

  it('names the session action Sign Out on Windows and Log Out elsewhere', async () => {
    vi.mocked(commands.systemActionsSupported).mockResolvedValue(['logOut']);

    await registerSystemCommands();
    let [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect(regs[0].name).toBe('Sign Out');

    vi.mocked(platform).mockReturnValue('macos');
    await registerSystemCommands();
    [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[1];
    expect(regs[0].name).toBe('Log Out');
  });

  it('registration failure is logged, not thrown', async () => {
    vi.mocked(commands.systemActionsSupported).mockResolvedValue(['sleep']);
    vi.mocked(commands.replaceDynamicCommandsBuiltin).mockRejectedValueOnce(new Error('boom'));

    await expect(registerSystemCommands()).resolves.toBeUndefined();
    expect(logService.error).toHaveBeenCalled();
  });

  it('unregister replaces the list with an empty one', async () => {
    await unregisterSystemCommands();
    expect(commands.replaceDynamicCommandsBuiltin).toHaveBeenCalledWith('system', []);
  });
});
