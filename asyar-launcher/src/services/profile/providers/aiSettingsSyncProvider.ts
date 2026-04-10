import { aiStore, type AISettings } from '../../../built-in-features/ai-chat/aiStore.svelte';
import type { ISyncProvider, SyncProviderData, ImportPreview, ImportResult, DataSummary, ConflictStrategy } from '../types';

export class AISettingsSyncProvider implements ISyncProvider {
  readonly id = 'ai-settings';
  readonly displayName = 'AI Settings';
  readonly icon = 'settings';
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'replace' as const;
  readonly sensitiveFields: string[] = ['apiKey'];

  async exportFull(): Promise<SyncProviderData> {
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: aiStore.settings,
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    return this.exportFull();
  }

  async preview(_incoming: SyncProviderData): Promise<ImportPreview> {
    return {
      localCount: 1,
      incomingCount: 1,
      conflicts: 1,
      newItems: 0,
      removedItems: 0,
    };
  }

  async applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult> {
    if (strategy === 'skip') {
      return { success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    // Both 'replace' and 'merge' update the settings
    const incomingSettings = incoming.data as AISettings;
    aiStore.updateAISettings(incomingSettings);
    return { success: true, itemsAdded: 0, itemsUpdated: 1, itemsRemoved: 0, warnings: [] };
  }

  async getLocalSummary(): Promise<DataSummary> {
    return { itemCount: 1, label: 'AI settings' };
  }
}
