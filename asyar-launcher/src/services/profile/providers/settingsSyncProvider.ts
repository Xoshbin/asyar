import { settingsService } from '../../../services/settings/settingsService.svelte';
import type { AppSettings } from '../../../services/settings/types/AppSettingsType';
import type { ISyncProvider, SyncProviderData, ImportPreview, ImportResult, DataSummary, ConflictStrategy } from '../types';

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
          await settingsService.updateSettings(section, incomingSettings[section] as any);
        }
      }
      return { success: true, itemsAdded: 0, itemsUpdated: 1, itemsRemoved: 0, warnings: [] };
    }

    // merge — apply only the keys present in incoming
    for (const section of Object.keys(incomingSettings) as Array<keyof AppSettings>) {
      const incomingSection = incomingSettings[section];
      if (incomingSection !== undefined) {
        await settingsService.updateSettings(section, incomingSection as any);
      }
    }
    return { success: true, itemsAdded: 0, itemsUpdated: 1, itemsRemoved: 0, warnings: [] };
  }

  async getLocalSummary(): Promise<DataSummary> {
    return { itemCount: 1, label: 'Application settings' };
  }
}
