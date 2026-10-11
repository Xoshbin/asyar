import {
  getUsageStats,
  aiUsageSummary,
  type UsageStats,
  type AiUsageSummary,
} from '../../lib/ipc/commands';

class UsageStatsState {
  stats = $state<UsageStats | null>(null);
  aiUsage = $state<AiUsageSummary | null>(null);

  async load(): Promise<void> {
    await Promise.all([
      getUsageStats().then((stats) => {
        this.stats = stats;
      }),
      aiUsageSummary(Date.now() - 30 * 24 * 60 * 60 * 1000).then((usage) => {
        this.aiUsage = usage;
      }),
    ]);
  }

  reset(): void {
    this.stats = null;
    this.aiUsage = null;
  }
}

export const usageStatsState = new UsageStatsState();
