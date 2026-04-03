import { shortcutStore, type ItemShortcut } from '../../../built-in-features/shortcuts/shortcutStore.svelte';
import type { ISyncProvider, SyncProviderData, ImportPreview, ImportResult, DataSummary, ConflictStrategy } from '../types';

export class ShortcutsSyncProvider implements ISyncProvider {
  readonly id = 'shortcuts';
  readonly displayName = 'Shortcuts';
  readonly icon = 'keyboard';
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'merge' as const;
  readonly sensitiveFields: string[] = [];

  async exportFull(): Promise<SyncProviderData> {
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: shortcutStore.getAll(),
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    return this.exportFull();
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const local = shortcutStore.getAll();
    const incomingItems = incoming.data as ItemShortcut[];
    const localObjectIds = new Set(local.map((s) => s.objectId));
    const incomingObjectIds = new Set(incomingItems.map((s) => s.objectId));

    return {
      localCount: local.length,
      incomingCount: incomingItems.length,
      conflicts: incomingItems.filter((s) => localObjectIds.has(s.objectId)).length,
      newItems: incomingItems.filter((s) => !localObjectIds.has(s.objectId)).length,
      removedItems: local.filter((s) => !incomingObjectIds.has(s.objectId)).length,
    };
  }

  async applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult> {
    const incomingItems = incoming.data as ItemShortcut[];

    if (strategy === 'skip') {
      return { success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    if (strategy === 'replace') {
      const existing = shortcutStore.getAll();
      for (const item of existing) {
        shortcutStore.remove(item.objectId);
      }
      for (const item of incomingItems) {
        shortcutStore.add(item);
      }
      return { success: true, itemsAdded: incomingItems.length, itemsUpdated: 0, itemsRemoved: existing.length, warnings: [] };
    }

    // merge — dedup by objectId
    const local = shortcutStore.getAll();
    const localByObjectId = new Map(local.map((s) => [s.objectId, s]));
    let added = 0;
    let updated = 0;

    for (const item of incomingItems) {
      const existing = localByObjectId.get(item.objectId);
      if (!existing) {
        shortcutStore.add(item);
        added++;
      } else if (item.createdAt > existing.createdAt) {
        shortcutStore.update(item.objectId, item);
        updated++;
      }
    }

    return { success: true, itemsAdded: added, itemsUpdated: updated, itemsRemoved: 0, warnings: [] };
  }

  async getLocalSummary(): Promise<DataSummary> {
    const items = shortcutStore.getAll();
    return { itemCount: items.length, label: `${items.length} shortcut${items.length !== 1 ? 's' : ''}` };
  }
}
