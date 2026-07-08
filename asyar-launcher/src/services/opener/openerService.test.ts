import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOpenerOpenUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../lib/ipc/commands', () => ({
  openerOpenUrl: mockOpenerOpenUrl,
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
});
