import { settingsService } from '../../../services/settings/settingsService.svelte';
import type { AISettings } from '../../settings/types/AppSettingsType';
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
      data: settingsService.currentSettings.ai,
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    // Export only the 5 active keys — legacy AI-Chat keys are excluded.
    const settings = settingsService.currentSettings.ai;
    const sanitizedProviders = Object.fromEntries(
      Object.entries(settings.providers).map(([id, config]) => {
        const copy = { ...config };
        delete (copy as Record<string, unknown>)['apiKey'];
        return [id, copy];
      })
    );
    return {
      providerId: this.id,
      version: 2,
      exportedAt: Date.now(),
      data: {
        providers: sanitizedProviders as AISettings['providers'],
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        defaultAgentId: settings.defaultAgentId,
        tabContinuesLastThread: settings.tabContinuesLastThread,
      },
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

    // Both 'replace' and 'merge' update the settings.
    // Strip legacy AI-Chat keys before forwarding so they never leak into settings.
    const raw = incoming.data as Record<string, unknown>;
    const filtered: Partial<AISettings> = {};
    const activeKeys: Array<keyof AISettings> = [
      'providers',
      'temperature',
      'maxTokens',
      'defaultAgentId',
      'tabContinuesLastThread',
    ];
    for (const key of activeKeys) {
      if (key in raw) (filtered as Record<string, unknown>)[key] = raw[key];
    }
    settingsService.updateSettings('ai', filtered as AISettings);
    return { success: true, itemsAdded: 0, itemsUpdated: 1, itemsRemoved: 0, warnings: [] };
  }

  async getLocalSummary(): Promise<DataSummary> {
    const enabledCount = Object.values(settingsService.currentSettings.ai.providers).filter(p => p.enabled).length;
    return { itemCount: 1, label: `AI settings (${enabledCount} provider${enabledCount !== 1 ? 's' : ''} enabled)` };
  }

  // ── Delta sync surface ──────────────────────────────────────────────────
  // ai-settings is a singleton stored under the 'ai' section of AppSettings.

  async exportItems(): Promise<SyncItem[]> {
    return [{ id: this.id, categoryId: this.id, content: settingsService.currentSettings.ai }];
  }

  async applyItemUpsert(item: SyncItem): Promise<void> {
    settingsService.updateSettings('ai', item.content as AISettings);
  }

  // The ai-settings singleton lives inside settings — there is no separate
  // delete; reject so a stray server-pushed delete can never wipe it.
  async applyItemDelete(_itemId: string): Promise<void> {
    throw new Error('cannot delete singleton ai-settings item');
  }

  subscribeToChanges(callback: (event: SyncChangeEvent) => void): Unsubscribe {
    // settingsService.currentSettings.ai holds the AI settings;
    // subscribing to settingsService picks up ai-settings changes.
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
