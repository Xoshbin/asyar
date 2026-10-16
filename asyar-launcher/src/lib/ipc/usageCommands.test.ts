import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./invokeSafe', () => ({
  invokeSafe: vi.fn(),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { invokeSafe } from './invokeSafe';
import { recordActiveDay, recordWorkerFallback } from './usageCommands';

describe('usageCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordActiveDay', () => {
    it('invokes record_active_day silently on happy path', async () => {
      vi.mocked(invokeSafe).mockResolvedValueOnce(undefined);
      await expect(recordActiveDay()).resolves.toBeUndefined();
      expect(invokeSafe).toHaveBeenCalledWith('record_active_day', undefined, { silent: true });
    });

    it('catches and suppresses invoke rejection so it never triggers unhandled rejection', async () => {
      vi.mocked(invokeSafe).mockRejectedValueOnce(
        new Error(
          'record_active_day: state not managed for field state on command record_active_day',
        ),
      );
      await expect(recordActiveDay()).resolves.toBeUndefined();
    });
  });

  describe('recordWorkerFallback', () => {
    it('invokes record_worker_fallback silently on happy path', async () => {
      vi.mocked(invokeSafe).mockResolvedValueOnce(undefined);
      await expect(recordWorkerFallback('ext-1')).resolves.toBeUndefined();
      expect(invokeSafe).toHaveBeenCalledWith(
        'record_worker_fallback',
        { extensionId: 'ext-1' },
        { silent: true },
      );
    });

    it('catches and suppresses invoke rejection so background fallback recording never throws', async () => {
      vi.mocked(invokeSafe).mockRejectedValueOnce(
        new Error(
          'record_worker_fallback: state not managed for field state on command record_worker_fallback',
        ),
      );
      await expect(recordWorkerFallback('ext-1')).resolves.toBeUndefined();
    });
  });
});
