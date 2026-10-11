import { getUsageStats, type UsageStats } from '../../lib/ipc/commands';

class UsageStatsState {
  stats = $state<UsageStats | null>(null);

  async load(): Promise<void> {
    this.stats = await getUsageStats();
  }

  reset(): void {
    this.stats = null;
  }
}

export const usageStatsState = new UsageStatsState();
