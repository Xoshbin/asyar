import { aiStore, type AISettings } from '../../../built-in-features/ai-chat/aiStore.svelte';
import { settingsService } from '../../../services/settings/settingsService.svelte';
import type {
  ISyncProvider,
  SyncProviderData,
  ImportPreview,
  ImportResult,
  DataSummary,
  ConflictStrategy,
  SyncItem,
  SyncChangeEvent,
  Unsubscribe,
} from '../types';

export class AISettingsSyncProvider implements ISyncProvider {
  readonly id = 'ai-settings';
  readonly displayName = 'AI Settings';
  readonly icon = 'settings';
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'replace' as const;
  // Note: API keys live inside providers.<id>.apiKey — we list them as sensitive
  readonly sensitiveFields: string[] = ['providers'];

  async exportFull(): Promise<SyncProviderData> {
    return {
      providerId: this.id,
      version: 2,
      exportedAt: Date.now(),
      data: aiStore.settings,
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    // Strip API keys before sync to avoid transmitting secrets
    const settings = aiStore.settings;
    const sanitizedProviders = Object.fromEntries(
      Object.entries(settings.providers).map(([id, config]) => [
        id,
        { ...config, apiKey: undefined },
      ])
    );
    return {
      providerId: this.id,
      version: 2,
      exportedAt: Date.now(),
      data: { ...settings, providers: sanitizedProviders as AISettings['providers'] },
    };
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
    const enabledCount = Object.values(aiStore.settings.providers).filter(p => p.enabled).length;
    return { itemCount: 1, label: `AI settings (${enabledCount} provider${enabledCount !== 1 ? 's' : ''} enabled)` };
  }

  // ── Delta sync surface ──────────────────────────────────────────────────
  // ai-settings is a singleton stored under the 'ai' section of AppSettings.

  async exportItems(): Promise<SyncItem[]> {
    return [{ id: this.id, categoryId: this.id, content: aiStore.settings }];
  }

  async applyItemUpsert(item: SyncItem): Promise<void> {
    aiStore.updateAISettings(item.content as AISettings);
  }

  // The ai-settings singleton lives inside settings — there is no separate
  // delete; reject so a stray server-pushed delete can never wipe it.
  async applyItemDelete(_itemId: string): Promise<void> {
    throw new Error('cannot delete singleton ai-settings item');
  }

  subscribeToChanges(callback: (event: SyncChangeEvent) => void): Unsubscribe {
    // aiStore.settings is a getter onto settingsService.currentSettings.ai,
    // so subscribing to settingsService picks up ai-settings changes too.
    let primed = false;
    const unsub = settingsService.subscribe(() => {
      if (!primed) {
        primed = true;
        return;
      }
      callback({ type: 'upsert', itemId: this.id, categoryId: this.id });
    });
    return unsub;
  }
}
