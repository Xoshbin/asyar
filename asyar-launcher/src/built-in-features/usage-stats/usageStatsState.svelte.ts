import { getUsageStats, type UsageStats } from '../../lib/ipc/commands';

class UsageStatsState {
  stats = $state<UsageStats | null>(null);

  async load(): Promise<void> {
    this.stats = await getUsageStats();
  }
}

export const usageStatsState = new UsageStatsState();
