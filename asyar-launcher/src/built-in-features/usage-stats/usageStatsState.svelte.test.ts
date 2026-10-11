import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  aiUsageSummary: vi
    .fn()
    .mockResolvedValue({ totals: { inputTokens: 10, outputTokens: 5 }, byModel: [] }),
  getUsageStats: vi.fn().mockResolvedValue({
    activeDays: 3,
    totalLaunches: 52,
    top: [
      { id: 'org.asyar.calculator', label: 'Calculator', count: 40 },
      { id: 'b', label: null, count: 12 },
    ],
  }),
}));

import { getUsageStats, aiUsageSummary } from '../../lib/ipc/commands';
import { usageStatsState } from './usageStatsState.svelte';

describe('usageStatsState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads stats from the host', async () => {
    await usageStatsState.load();
    expect(getUsageStats).toHaveBeenCalled();
    expect(usageStatsState.stats?.totalLaunches).toBe(52);
    expect(usageStatsState.stats?.activeDays).toBe(3);
    expect(usageStatsState.stats?.top[0].id).toBe('org.asyar.calculator');
    expect(usageStatsState.stats?.top[0].label).toBe('Calculator');
  });

  it('loads AI usage for the last 30 days independently of launch stats', async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValueOnce(now);
    await usageStatsState.load();
    expect(aiUsageSummary).toHaveBeenCalledWith(now - 30 * 24 * 60 * 60 * 1000);
    expect(usageStatsState.aiUsage?.totals.inputTokens).toBe(10);
    usageStatsState.reset();
    expect(usageStatsState.aiUsage).toBeNull();
  });
});
