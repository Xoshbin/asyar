import { getUsageAnonId, resetUsageAnonId } from '../../lib/ipc/commands';

class UsageShareState {
  anonId = $state('');

  async load() {
    this.anonId = (await getUsageAnonId()) ?? '';
  }

  async reset() {
    this.anonId = (await resetUsageAnonId()) ?? '';
  }
}

export const usageShareState = new UsageShareState();
