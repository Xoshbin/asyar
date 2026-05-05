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
import {
  extensionPreferencesExportAll,
  extensionPreferencesImportAll,
  type PreferencesExport,
} from '../../../lib/ipc/extensionPreferencesCommands';
import { listen } from '@tauri-apps/api/event';
import { logService } from '../../log/logService';

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

  // ── Delta sync surface ──────────────────────────────────────────────────
  // Treated as a singleton aggregate: one item carrying all preference rows.
  // Granular per-row deltas would require Rust changes to the export shape,
  // which is out of scope for the TypeScript-only Task 4A surface.

  async exportItems(): Promise<SyncItem[]> {
    const data = await extensionPreferencesExportAll();
    return [{ id: this.id, categoryId: this.id, content: data }];
  }

  async applyItemUpsert(item: SyncItem): Promise<void> {
    const payload = (item.content as PreferencesExport) ?? { rows: [] };
    // 'replace' is the default conflict strategy for this category — when a
    // server-pushed upsert arrives, we apply the full row set authoritatively.
    await extensionPreferencesImportAll(payload, 'replace');
  }

  // The aggregate singleton always exists (it may be empty). A server-pushed
  // delete shouldn't wipe every preference silently — reject so the operator
  // has to make that call explicitly via a different code path.
  async applyItemDelete(_itemId: string): Promise<void> {
    throw new Error('cannot delete singleton extension-preferences item');
  }

  subscribeToChanges(callback: (event: SyncChangeEvent) => void): Unsubscribe {
    // Rust emits `asyar:preferences-changed` whenever a preference row is
    // set or reset. Fold every event into a single upsert for the singleton.
    let stop: (() => void) | null = null;
    let cancelled = false;
    listen('asyar:preferences-changed', () => {
      callback({ type: 'upsert', itemId: this.id, categoryId: this.id });
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        stop = unlisten;
      })
      .catch((err) => {
        logService.warn(`extension-preferences subscribeToChanges listen failed: ${err}`);
      });
    return () => {
      cancelled = true;
      if (stop) stop();
    };
  }
}
