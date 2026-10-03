import { getUsageAnonId, resetUsageAnonId } from '../../lib/ipc/commands';

class UsageShareState {
  anonId = $state('');

  async load() {
    this.anonId = await getUsageAnonId().catch(() => '');
  }

  async reset() {
    this.anonId = await resetUsageAnonId().catch(() => '');
  }
}

export const usageShareState = new UsageShareState();
