import type {
  ISyncProvider,
  SyncProviderData,
  ImportPreview,
  ImportResult,
  DataSummary,
  ConflictStrategy,
} from '../types';
import {
  extensionPreferencesExportAll,
  extensionPreferencesImportAll,
  type PreferencesExport,
} from '../../../lib/ipc/extensionPreferencesCommands';

/**
 * Sync provider for extension preferences. Password-type values are
 * excluded at the Rust query layer (`WHERE is_encrypted = 0`) and never
 * leave the device — users re-enter API keys and secrets on each machine.
 * Defense-in-depth: the `sensitiveFields` hint is documentation; the
 * actual filter is enforced in Rust.
 */
export class ExtensionPreferencesSyncProvider implements ISyncProvider {
  readonly id = 'extension-preferences';
  readonly displayName = 'Extension Preferences';
  readonly icon = 'sliders';
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'replace' as const;
  readonly sensitiveFields: string[] = ['password'];

  async exportFull(): Promise<SyncProviderData> {
    return this.exportForSync();
  }

  async exportForSync(): Promise<SyncProviderData> {
    const data = await extensionPreferencesExportAll();
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data,
    };
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const incomingData = (incoming.data as PreferencesExport) ?? { rows: [] };
    const local = await extensionPreferencesExportAll();
    // Build a set of "extensionId|commandId|key" keys for quick lookup.
    const key = (r: { extensionId: string; commandId: string | null; key: string }) =>
      `${r.extensionId}|${r.commandId ?? ''}|${r.key}`;
    const localKeys = new Set(local.rows.map(key));
    let conflicts = 0;
    let newItems = 0;
    for (const r of incomingData.rows) {
      if (localKeys.has(key(r))) {
        conflicts += 1;
      } else {
        newItems += 1;
      }
    }
    return {
      localCount: local.rows.length,
      incomingCount: incomingData.rows.length,
      conflicts,
      newItems,
      removedItems: 0,
    };
  }

  async applyImport(
    incoming: SyncProviderData,
    strategy: ConflictStrategy
  ): Promise<ImportResult> {
    if (strategy === 'skip') {
      return {
        success: true,
        itemsAdded: 0,
        itemsUpdated: 0,
        itemsRemoved: 0,
        warnings: [],
      };
    }
    const payload = (incoming.data as PreferencesExport) ?? { rows: [] };
    const result = await extensionPreferencesImportAll(
      payload,
      strategy as 'replace' | 'merge'
    );
    return {
      success: true,
      itemsAdded: result.itemsAdded,
      itemsUpdated: result.itemsUpdated,
      itemsRemoved: 0,
      warnings: [],
    };
  }

  async getLocalSummary(): Promise<DataSummary> {
    const data = await extensionPreferencesExportAll();
    const count = data.rows.length;
    return {
      itemCount: count,
      label: count === 1 ? '1 preference' : `${count} preferences`,
    };
  }
}
