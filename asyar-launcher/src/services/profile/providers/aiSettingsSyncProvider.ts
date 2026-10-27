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
  // Note: API keys live inside providers.<id>.apiKey and webSearch.apiKey — listed as sensitive
  readonly sensitiveFields: string[] = ['providers', 'webSearch.apiKey'];

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
      }),
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
    const enabledCount = Object.values(settingsService.currentSettings.ai.providers).filter(
      (p) => p.enabled,
    ).length;
    return {
      itemCount: 1,
      label: `AI settings (${enabledCount} provider${enabledCount !== 1 ? 's' : ''} enabled)`,
    };
  }

  // ── Delta sync surface ──────────────────────────────────────────────────
  // ai-settings is a singleton stored under the 'ai' section of AppSettings.

  async exportItems(): Promise<SyncItem[]> {
    return [{ id: this.id, categoryId: this.id, content: settingsService.currentSettings.ai }];
  }

  async applyItemUpsert(item: SyncItem): Promise<void> {
    const sanitized = sanitizeIncomingAiSettings(
      item.content as Partial<AISettings>,
      settingsService.currentSettings.ai,
    );
    await settingsService.updateSettings('ai', sanitized);
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

/**
 * Normalizes incoming AI settings for delta sync upserts.
 * Omits 'providers' so local provider configurations and credentials remain intact.
 * Merges 'webSearch' while preserving this device's own 'webSearch.apiKey'.
 */
function sanitizeIncomingAiSettings(
  incoming: Partial<AISettings> | null | undefined,
  localAi: AISettings | undefined,
): Partial<AISettings> {
  if (!incoming || typeof incoming !== 'object') {
    return {};
  }

  const sanitized: Partial<AISettings> = { ...incoming };

  // Provider configurations and keys are kept device-local
  delete sanitized.providers;

  // When webSearch is present in incoming data, merge while preserving local apiKey
  if ('webSearch' in incoming && incoming.webSearch && typeof incoming.webSearch === 'object') {
    const localWebSearch = localAi?.webSearch;
    const mergedWebSearch: NonNullable<AISettings['webSearch']> = {
      ...localWebSearch,
      ...incoming.webSearch,
    };

    if (localWebSearch?.apiKey !== undefined) {
      mergedWebSearch.apiKey = localWebSearch.apiKey;
    } else {
      delete mergedWebSearch.apiKey;
    }

    sanitized.webSearch = mergedWebSearch;
  }

  return sanitized;
}
