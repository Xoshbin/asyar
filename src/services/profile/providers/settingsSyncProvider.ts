import { settingsService } from '../../../services/settings/settingsService.svelte';
import type { AppSettings } from '../../../services/settings/types/AppSettingsType';
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

export class SettingsSyncProvider implements ISyncProvider {
  readonly id = 'settings';
  readonly displayName = 'Application Settings';
  readonly icon = 'settings';
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'replace' as const;
  readonly sensitiveFields: string[] = [];

  async exportFull(): Promise<SyncProviderData> {
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: settingsService.getSettings(),
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

    const incomingSettings = incoming.data as Partial<AppSettings>;

    if (strategy === 'replace') {
      for (const section of Object.keys(incomingSettings) as Array<keyof AppSettings>) {
        if (incomingSettings[section] !== undefined) {
          // updateSettings is generic over the section key — TS can't narrow
          // here without a per-key dispatch. The cast is contained and safe.
          await settingsService.updateSettings(section, incomingSettings[section] as Partial<AppSettings[typeof section]>);
        }
      }
      return { success: true, itemsAdded: 0, itemsUpdated: 1, itemsRemoved: 0, warnings: [] };
    }

    // merge — apply only the keys present in incoming
    for (const section of Object.keys(incomingSettings) as Array<keyof AppSettings>) {
      const incomingSection = incomingSettings[section];
      if (incomingSection !== undefined) {
        await settingsService.updateSettings(section, incomingSection as Partial<AppSettings[typeof section]>);
      }
    }
    return { success: true, itemsAdded: 0, itemsUpdated: 1, itemsRemoved: 0, warnings: [] };
  }

  async getLocalSummary(): Promise<DataSummary> {
    return { itemCount: 1, label: 'Application settings' };
  }

  // ── Delta sync surface ──────────────────────────────────────────────────
  // Settings is a singleton: one item with id === categoryId === 'settings'.

  async exportItems(): Promise<SyncItem[]> {
    return [{ id: this.id, categoryId: this.id, content: settingsService.getSettings() }];
  }

  async applyItemUpsert(item: SyncItem): Promise<void> {
    const incomingSettings = item.content as Partial<AppSettings>;
    for (const section of Object.keys(incomingSettings) as Array<keyof AppSettings>) {
      const value = incomingSettings[section];
      if (value !== undefined) {
        await settingsService.updateSettings(section, value as Partial<AppSettings[typeof section]>);
      }
    }
  }

  // The settings singleton always exists — there is no meaningful "delete"
  // for it. Reject so a server-pushed delete on category=settings can never
  // silently wipe the user's configuration.
  async applyItemDelete(_itemId: string): Promise<void> {
    throw new Error('cannot delete singleton settings item');
  }

  subscribeToChanges(callback: (event: SyncChangeEvent) => void): Unsubscribe {
    // settingsService.subscribe runs the callback eagerly; fold every
    // notification into a single "upsert" for the singleton id.
    let primed = false;
    const unsub = settingsService.subscribe(() => {
      // Skip the priming call so we don't emit a spurious change event on
      // first subscribe — only real updates produce one.
      if (!primed) {
        primed = true;
        return;
      }
      callback({ type: 'upsert', itemId: this.id, categoryId: this.id });
    });
    return unsub;
  }
}
