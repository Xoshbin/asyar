import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  extCacheGet: vi.fn(),
  extCacheSet: vi.fn(),
  extCacheDelete: vi.fn(),
  extCacheClear: vi.fn(),
}));

import { extensionCacheService } from './extensionCacheService';
import { extCacheGet, extCacheSet, extCacheDelete, extCacheClear } from '../../lib/ipc/commands';

describe('extensionCacheService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('get', () => {
    it('returns value when cache hit', async () => {
      vi.mocked(extCacheGet).mockResolvedValue('cached');

      const result = await extensionCacheService.get('ext.a', 'key1');

      expect(extCacheGet).toHaveBeenCalledWith('ext.a', 'key1');
      expect(result).toBe('cached');
    });

    it('returns undefined when cache returns null', async () => {
      vi.mocked(extCacheGet).mockResolvedValue(null);

      const result = await extensionCacheService.get('ext.a', 'key1');

      expect(result).toBeUndefined();
    });
  });

  describe('set', () => {
    it('passes expiresAt to the command', async () => {
      vi.mocked(extCacheSet).mockResolvedValue(undefined);

      await extensionCacheService.set('ext.a', 'key1', 'val1', 1700000000);

      expect(extCacheSet).toHaveBeenCalledWith('ext.a', 'key1', 'val1', 1700000000);
    });

    it('passes undefined expiresAt when omitted', async () => {
      vi.mocked(extCacheSet).mockResolvedValue(undefined);

      await extensionCacheService.set('ext.a', 'key1', 'val1');

      expect(extCacheSet).toHaveBeenCalledWith('ext.a', 'key1', 'val1', undefined);
    });
  });

  describe('delete', () => {
    it('returns true when key existed', async () => {
      vi.mocked(extCacheDelete).mockResolvedValue(true);

      const result = await extensionCacheService.delete('ext.a', 'key1');

      expect(extCacheDelete).toHaveBeenCalledWith('ext.a', 'key1');
      expect(result).toBe(true);
    });

    it('returns false when key did not exist', async () => {
      vi.mocked(extCacheDelete).mockResolvedValue(false);

      const result = await extensionCacheService.delete('ext.a', 'missing');

      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('returns count of cleared entries', async () => {
      vi.mocked(extCacheClear).mockResolvedValue(5);

      const result = await extensionCacheService.clear('ext.a');

      expect(extCacheClear).toHaveBeenCalledWith('ext.a');
      expect(result).toBe(5);
    });
  });
});
