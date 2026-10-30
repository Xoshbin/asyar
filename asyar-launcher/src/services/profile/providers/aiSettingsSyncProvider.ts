import { settingsService } from '../../../services/settings/settingsService.svelte';
import { aiSaveCredential } from '../../../lib/ipc/commands';
import { logService } from '../../../services/log/logService';
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
  // Note: API keys live in encrypted SQLite store and are never exported in profiles.
  readonly sensitiveFields: string[] = [];

  async exportFull(): Promise<SyncProviderData> {
    return {
      providerId: this.id,
      version: 2,
      exportedAt: Date.now(),
      data: withoutApiKeys(settingsService.currentSettings.ai),
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    // Export only the active keys — legacy AI-Chat keys are excluded.
    const settings = withoutApiKeys(settingsService.currentSettings.ai);
    return {
      providerId: this.id,
      version: 2,
      exportedAt: Date.now(),
      data: {
        providers: settings.providers,
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

    const warnings: string[] = [];
    const raw = (incoming.data ? JSON.parse(JSON.stringify(incoming.data)) : {}) as Record<
      string,
      unknown
    >;
    await migrateLegacyExportKeys(raw, warnings);

    // Both 'replace' and 'merge' update the settings.
    // Strip legacy AI-Chat keys before forwarding so they never leak into settings.
    const filtered: Partial<AISettings> = {};
    const activeKeys: Array<keyof AISettings> = [
      'providers',
      'temperature',
      'maxTokens',
      'defaultAgentId',
      'tabContinuesLastThread',
      'historyRetentionCap',
      'webSearch',
    ];
    for (const key of activeKeys) {
      if (key in raw) (filtered as Record<string, unknown>)[key] = raw[key];
    }
    settingsService.updateSettings('ai', filtered as AISettings);

    const dedupedWarnings = Array.from(new Set(warnings));
    return {
      success: true,
      itemsAdded: 0,
      itemsUpdated: 1,
      itemsRemoved: 0,
      warnings: dedupedWarnings,
    };
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
    return [
      {
        id: this.id,
        categoryId: this.id,
        content: withoutApiKeys(settingsService.currentSettings.ai),
      },
    ];
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

/** Copy of the AI settings with any `apiKey` removed from providers and web search. */
function withoutApiKeys(ai: AISettings): AISettings {
  const providers = Object.fromEntries(
    Object.entries(ai.providers ?? {}).map(([id, config]) => {
      const copy = { ...config } as Record<string, unknown>;
      delete copy['apiKey'];
      return [id, copy];
    }),
  ) as unknown as AISettings['providers'];

  const result: AISettings = { ...ai, providers };
  if (ai.webSearch) {
    const webSearch = { ...ai.webSearch } as Record<string, unknown>;
    delete webSearch['apiKey'];
    result.webSearch = webSearch as unknown as AISettings['webSearch'];
  }
  return result;
}

const KEYED_WEB_SEARCH_ENGINES = ['brave', 'tavily', 'serply'];
const KEY_IMPORT_WARNING = "some API keys couldn't be imported; please re-enter them";

/**
 * COMPAT(remove in 0.2.0): old .asyar exports carry apiKey
 *
 * Normalizes an old-format export in place so only the new shape reaches `settings.dat`:
 * - `providers.<id>.apiKey` and `webSearch.apiKey` are moved into the encrypted credential
 *   store (a web-search key is stored for the export's own `webSearch.engine`; if that engine
 *   isn't a keyed one we can't tell which service the key was for, so it's skipped with a warning)
 *   and then deleted from the payload;
 * - top-level `null` fields are dropped. Old password-less exports wrote `providers: null`
 *   (it was a sensitive field), which would otherwise wipe every local provider on import.
 */
async function migrateLegacyExportKeys(
  raw: Record<string, unknown>,
  warnings: string[],
): Promise<void> {
  for (const key of Object.keys(raw)) {
    if (raw[key] === null) delete raw[key];
  }

  const saveKey = async (
    target: Parameters<typeof aiSaveCredential>[0],
    secret: unknown,
    label: string,
  ) => {
    if (typeof secret !== 'string' || !secret.trim()) return;
    try {
      await aiSaveCredential(target, secret.trim());
    } catch (err) {
      logService.error(`Failed to import API key for ${label}: ${String(err)}`);
      warnings.push(KEY_IMPORT_WARNING);
    }
  };

  if (raw.providers && typeof raw.providers === 'object') {
    const providers = raw.providers as Record<string, Record<string, unknown> | null>;
    for (const [id, cfg] of Object.entries(providers)) {
      if (cfg && typeof cfg === 'object' && 'apiKey' in cfg) {
        const secret = cfg['apiKey'];
        delete cfg['apiKey'];
        await saveKey({ type: 'provider', id }, secret, `provider ${id}`);
      }
    }
  }

  if (raw.webSearch && typeof raw.webSearch === 'object') {
    const webSearch = raw.webSearch as Record<string, unknown>;
    if ('apiKey' in webSearch) {
      const secret = webSearch['apiKey'];
      delete webSearch['apiKey'];
      const engine = webSearch['engine'];
      if (typeof engine === 'string' && KEYED_WEB_SEARCH_ENGINES.includes(engine)) {
        await saveKey({ type: 'webSearch', engine }, secret, `web search (${engine})`);
      } else if (typeof secret === 'string' && secret.trim()) {
        logService.warn(
          'Skipped imported web-search API key: its engine does not identify which service it was for',
        );
        warnings.push(KEY_IMPORT_WARNING);
      }
    }
  }
}

/**
 * Normalizes incoming AI settings for delta sync upserts.
 * Omits 'providers' so local provider configurations and credentials remain intact.
 * Merges 'webSearch' while stripping any incoming apiKey.
 */
export function sanitizeIncomingAiSettings(
  incoming: Partial<AISettings> | null | undefined,
  localAi: AISettings | undefined,
): Partial<AISettings> {
  if (!incoming || typeof incoming !== 'object') {
    return {};
  }

  const sanitized: Partial<AISettings> = { ...incoming };

  // Provider configurations and keys are kept device-local
  delete sanitized.providers;

  // When webSearch is present in incoming data, merge while stripping any remote apiKey
  if ('webSearch' in incoming && incoming.webSearch && typeof incoming.webSearch === 'object') {
    const localWebSearch = localAi?.webSearch;
    const mergedWebSearch: Record<string, unknown> = {
      ...localWebSearch,
      ...incoming.webSearch,
    };
    delete mergedWebSearch['apiKey'];
    sanitized.webSearch = mergedWebSearch as unknown as AISettings['webSearch'];
  }

  return sanitized;
}
