import { portalStore, type Portal } from '../../../built-in-features/portals/portalStore.svelte';
import type { ISyncProvider, SyncProviderData, ImportPreview, ImportResult, DataSummary, ConflictStrategy } from '../types';

export class PortalsSyncProvider implements ISyncProvider {
  readonly id = 'portals';
  readonly displayName = 'Portals';
  readonly icon = 'globe';
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'merge' as const;
  readonly sensitiveFields: string[] = [];

  async exportFull(): Promise<SyncProviderData> {
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: portalStore.getAll(),
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    return this.exportFull();
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const local = portalStore.getAll();
    const incomingItems = incoming.data as Portal[];
    const localIds = new Set(local.map((p) => p.id));
    const incomingIds = new Set(incomingItems.map((p) => p.id));

    return {
      localCount: local.length,
      incomingCount: incomingItems.length,
      conflicts: incomingItems.filter((p) => localIds.has(p.id)).length,
      newItems: incomingItems.filter((p) => !localIds.has(p.id)).length,
      removedItems: local.filter((p) => !incomingIds.has(p.id)).length,
    };
  }

  async applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult> {
    const incomingItems = incoming.data as Portal[];

    if (strategy === 'skip') {
      return { success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    if (strategy === 'replace') {
      const existing = portalStore.getAll();
      for (const item of existing) {
        portalStore.remove(item.id);
      }
      for (const item of incomingItems) {
        portalStore.add(item);
      }
      return { success: true, itemsAdded: incomingItems.length, itemsUpdated: 0, itemsRemoved: existing.length, warnings: [] };
    }

    // merge — dedup by id
    const local = portalStore.getAll();
    const localById = new Map(local.map((p) => [p.id, p]));
    let added = 0;
    let updated = 0;

    for (const item of incomingItems) {
      const existing = localById.get(item.id);
      if (!existing) {
        portalStore.add(item);
        added++;
      } else if (item.createdAt > existing.createdAt) {
        portalStore.update(item.id, item);
        updated++;
      }
    }

    return { success: true, itemsAdded: added, itemsUpdated: updated, itemsRemoved: 0, warnings: [] };
  }

  async getLocalSummary(): Promise<DataSummary> {
    const items = portalStore.getAll();
    return { itemCount: items.length, label: `${items.length} portal${items.length !== 1 ? 's' : ''}` };
  }
}
