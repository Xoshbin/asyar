import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  getUsageAnonId: vi.fn().mockResolvedValue('abc-id'),
  resetUsageAnonId: vi.fn().mockResolvedValue('new-id'),
}));

import { getUsageAnonId, resetUsageAnonId } from '../../lib/ipc/commands';
import { usageShareState } from './usageShareState.svelte';

describe('usageShareState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usageShareState.anonId = '';
  });

  it('load() sets anonId from getUsageAnonId', async () => {
    await usageShareState.load();
    expect(getUsageAnonId).toHaveBeenCalled();
    expect(usageShareState.anonId).toBe('abc-id');
  });

  it('reset() calls resetUsageAnonId and sets anonId', async () => {
    await usageShareState.reset();
    expect(resetUsageAnonId).toHaveBeenCalled();
    expect(usageShareState.anonId).toBe('new-id');
  });
});
