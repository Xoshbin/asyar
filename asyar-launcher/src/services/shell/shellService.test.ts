import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('./shellConsentService.svelte', () => ({
  shellConsentService: { requestConsent: vi.fn().mockResolvedValue(true) },
}));
vi.mock('../extension/streamDispatcher.svelte', () => ({
  streamDispatcher: {
    create: vi.fn().mockReturnValue({
      onAbort: vi.fn(),
      sendChunk: vi.fn(),
      sendDone: vi.fn(),
      sendError: vi.fn(),
    }),
  },
}));

import { invoke } from '@tauri-apps/api/core';
import { shellService } from './shellService.svelte';
import { shellConsentService } from './shellConsentService.svelte';

describe('ShellService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shellConsentService.requestConsent).mockResolvedValue(true);
  });

  describe('spawn(extensionId, program, args, spawnId) — IPC router positional dispatch', () => {
    it('resolves the program path using shell_resolve_path', async () => {
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'shell_resolve_path') return Promise.resolve('/usr/bin/echo');
        return Promise.resolve(undefined);
      });

      // Called with individual positional args (how the IPC router dispatches via Object.values)
      await shellService.spawn('org.asyar.sdk-playground', 'echo', ['Hello'], 'spawn-1');

      expect(invoke).toHaveBeenCalledWith('shell_resolve_path', { program: 'echo' });
    });

    it('passes the resolved path to the consent service', async () => {
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'shell_resolve_path') return Promise.resolve('/usr/bin/echo');
        return Promise.resolve(undefined);
      });

      await shellService.spawn('org.asyar.sdk-playground', 'echo', ['Hello'], 'spawn-1');

      expect(shellConsentService.requestConsent).toHaveBeenCalledWith(
        'org.asyar.sdk-playground',
        'echo',
        '/usr/bin/echo',
      );
    });

    it('returns { streaming: true }', async () => {
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'shell_resolve_path') return Promise.resolve('/usr/bin/echo');
        return Promise.resolve(undefined);
      });

      const result = await shellService.spawn('org.asyar.sdk-playground', 'echo', [], 'spawn-1');

      expect(result).toEqual({ streaming: true });
    });

    it('throws PERMISSION_DENIED when consent is denied', async () => {
      vi.mocked(invoke).mockResolvedValue('/usr/bin/echo');
      vi.mocked(shellConsentService.requestConsent).mockResolvedValue(false);

      await expect(
        shellService.spawn('org.asyar.sdk-playground', 'echo', [], 'spawn-1'),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('invokes shell_spawn with the resolved path, not the short name', async () => {
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'shell_resolve_path') return Promise.resolve('/opt/homebrew/bin/git');
        return Promise.resolve(undefined);
      });

      await shellService.spawn('org.asyar.sdk-playground', 'git', ['status'], 'spawn-2');

      expect(invoke).toHaveBeenCalledWith('shell_spawn', expect.objectContaining({
        program: '/opt/homebrew/bin/git',
        args: ['status'],
        spawnId: 'spawn-2',
        extensionId: 'org.asyar.sdk-playground',
      }));
    });
  });
});
