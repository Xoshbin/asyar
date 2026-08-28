import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOpenerOpenUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockOpenerOpenPath = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockOpenerReveal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../lib/ipc/commands', () => ({
  openerOpenUrl: mockOpenerOpenUrl,
  openerOpenPath: mockOpenerOpenPath,
  openerReveal: mockOpenerReveal,
}));

import { OpenerService } from './openerService';

function makeSvc() {
  return new OpenerService();
}

describe('OpenerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('open', () => {
    it('does nothing when url is empty', async () => {
      await makeSvc().open('ext.a', '');
      expect(mockOpenerOpenUrl).not.toHaveBeenCalled();
    });

    it('forwards the caller identity and url to the gated command', async () => {
      await makeSvc().open('ext.a', 'steam://run/3932890');
      expect(mockOpenerOpenUrl).toHaveBeenCalledWith('ext.a', 'steam://run/3932890');
    });

    it('passes null for privileged host-context callers', async () => {
      await makeSvc().open(null, 'https://example.com');
      expect(mockOpenerOpenUrl).toHaveBeenCalledWith(null, 'https://example.com');
    });

    it('propagates denials as rejections', async () => {
      mockOpenerOpenUrl.mockRejectedValueOnce(
        new Error("not in the caller's declared scheme list"),
      );
      await expect(makeSvc().open('ext.a', 'steam://run/42')).rejects.toThrow('declared scheme');
    });
  });

  describe('openPath', () => {
    it('does nothing when path is empty', async () => {
      await makeSvc().openPath('ext.a', '');
      expect(mockOpenerOpenPath).not.toHaveBeenCalled();
    });

    it('forwards caller identity, path, and with option to openerOpenPath', async () => {
      await makeSvc().openPath('ext.a', '/path/to/project', { with: 'Zed' });
      expect(mockOpenerOpenPath).toHaveBeenCalledWith('ext.a', '/path/to/project', 'Zed');
    });

    it('forwards caller identity and path when with option is undefined', async () => {
      await makeSvc().openPath('ext.a', '/path/to/file.txt');
      expect(mockOpenerOpenPath).toHaveBeenCalledWith('ext.a', '/path/to/file.txt', undefined);
    });

    it('passes null for privileged host-context callers', async () => {
      await makeSvc().openPath(null, '/path/to/folder', { with: 'Finder' });
      expect(mockOpenerOpenPath).toHaveBeenCalledWith(null, '/path/to/folder', 'Finder');
    });

    it('propagates errors as rejections', async () => {
      mockOpenerOpenPath.mockRejectedValueOnce(
        new Error('Extension "ext.a" requires the "shell:open-path" permission.'),
      );
      await expect(makeSvc().openPath('ext.a', '/path/to/project')).rejects.toThrow(
        'shell:open-path',
      );
    });
  });

  describe('reveal', () => {
    it('does nothing when path is empty', async () => {
      await makeSvc().reveal('ext.a', '');
      expect(mockOpenerReveal).not.toHaveBeenCalled();
    });

    it('forwards caller identity and path to openerReveal', async () => {
      await makeSvc().reveal('ext.a', '/path/to/file.txt');
      expect(mockOpenerReveal).toHaveBeenCalledWith('ext.a', '/path/to/file.txt');
    });

    it('passes null for privileged host-context callers', async () => {
      await makeSvc().reveal(null, '/path/to/file.txt');
      expect(mockOpenerReveal).toHaveBeenCalledWith(null, '/path/to/file.txt');
    });

    it('propagates errors as rejections', async () => {
      mockOpenerReveal.mockRejectedValueOnce(
        new Error('Extension "ext.a" requires the "fs:read" permission.'),
      );
      await expect(makeSvc().reveal('ext.a', '/path/to/file.txt')).rejects.toThrow('fs:read');
    });
  });
});
