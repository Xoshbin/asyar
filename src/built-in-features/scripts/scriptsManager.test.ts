import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  scriptsRescan: vi.fn(async () => []),
  replaceDynamicCommandsBuiltin: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { scriptsManager } from './scriptsManager.svelte';
import * as commands from '../../lib/ipc/commands';
import { listen } from '@tauri-apps/api/event';
import type { ScannedScript } from './types';

const mockScript: ScannedScript = {
  absolutePath: '/home/user/scripts/deploy.sh',
  dynamicId: 'dyn-abc123',
  header: {
    title: 'Deploy',
    icon: null,
    arguments: [],
  },
  executable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  scriptsManager.reset();
});

describe('ScriptsManager', () => {
  it('start_subscribes_to_scripts_changed_event', async () => {
    await scriptsManager.start();

    expect(listen).toHaveBeenCalledWith('scripts:changed', expect.any(Function));
  });

  it('start_calls_initial_rescan_and_registers', async () => {
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([mockScript]);

    await scriptsManager.start();

    expect(commands.scriptsRescan).toHaveBeenCalled();
    expect(commands.replaceDynamicCommandsBuiltin).toHaveBeenCalledWith(
      'scripts',
      expect.arrayContaining([
        expect.objectContaining({ id: mockScript.dynamicId }),
      ]),
    );
  });

  it('scripts_changed_event_triggers_rescan', async () => {
    let capturedHandler: (() => void) | null = null;
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      capturedHandler = handler as () => void;
      return () => {};
    });

    await scriptsManager.start();

    expect(commands.scriptsRescan).toHaveBeenCalledTimes(1);

    capturedHandler!();
    await Promise.resolve();

    expect(commands.scriptsRescan).toHaveBeenCalledTimes(2);
  });

  it('start_with_titled_script_uses_title_as_command_name', async () => {
    const titled: ScannedScript = { ...mockScript, header: { ...mockScript.header, title: 'Deploy' } };
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([titled]);

    await scriptsManager.start();

    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect((regs as { name: string }[])[0].name).toBe('Deploy');
  });

  it('start_with_no_title_falls_back_to_filename', async () => {
    const untitled: ScannedScript = {
      ...mockScript,
      absolutePath: '/home/user/scripts/my_backup.sh',
      header: { ...mockScript.header, title: null },
    };
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([untitled]);

    await scriptsManager.start();

    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    const name = (regs as { name: string }[])[0].name;
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
    expect(name).toContain('my_backup');
  });

  it('start_uses_header_icon_when_script_declares_one', async () => {
    const withIcon: ScannedScript = {
      ...mockScript,
      header: { ...mockScript.header, icon: 'icon:cloud-upload' },
    };
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([withIcon]);

    await scriptsManager.start();

    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect((regs as { icon: string }[])[0].icon).toBe('icon:cloud-upload');
  });

  it('start_falls_back_to_terminal_icon_when_script_omits_one', async () => {
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([mockScript]);

    await scriptsManager.start();

    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect((regs as { icon: string }[])[0].icon).toBe('icon:terminal');
  });

  it('stop_clears_registrations_and_unsubscribes', async () => {
    const unlistenFn = vi.fn();
    vi.mocked(listen).mockResolvedValueOnce(unlistenFn);

    await scriptsManager.start();
    await scriptsManager.stop();

    expect(commands.replaceDynamicCommandsBuiltin).toHaveBeenCalledWith('scripts', []);
    expect(unlistenFn).toHaveBeenCalled();
  });

  it('getScriptByDynamicId_returns_script_when_present', async () => {
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([mockScript]);
    await scriptsManager.start();

    const result = scriptsManager.getScriptByDynamicId(mockScript.dynamicId);
    expect(result).toEqual(mockScript);
  });

  it('getScriptByDynamicId_returns_undefined_for_unknown', async () => {
    await scriptsManager.start();

    const result = scriptsManager.getScriptByDynamicId('ghost-id');
    expect(result).toBeUndefined();
  });
});
