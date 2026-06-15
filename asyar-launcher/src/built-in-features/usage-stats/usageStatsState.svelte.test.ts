import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  getUsageStats: vi.fn().mockResolvedValue({
    activeDays: 3,
    totalLaunches: 52,
    top: [
      { id: 'org.asyar.calculator', label: 'Calculator', count: 40 },
      { id: 'b', label: null, count: 12 },
    ],
  }),
}));

import { getUsageStats } from '../../lib/ipc/commands';
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
});
