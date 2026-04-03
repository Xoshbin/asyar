import { snippetStore, type Snippet } from '../../../built-in-features/snippets/snippetStore.svelte';
import type { ISyncProvider, SyncProviderData, ImportPreview, ImportResult, DataSummary, ConflictStrategy } from '../types';

export class SnippetsSyncProvider implements ISyncProvider {
  readonly id = 'snippets';
  readonly displayName = 'Snippets';
  readonly icon = 'text-expand';
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'merge' as const;
  readonly sensitiveFields: string[] = [];

  async exportFull(): Promise<SyncProviderData> {
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: snippetStore.getAll(),
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    return this.exportFull();
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const local = snippetStore.getAll();
    const incomingItems = incoming.data as Snippet[];
    const localIds = new Set(local.map((s) => s.id));
    const incomingIds = new Set(incomingItems.map((s) => s.id));

    return {
      localCount: local.length,
      incomingCount: incomingItems.length,
      conflicts: incomingItems.filter((s) => localIds.has(s.id)).length,
      newItems: incomingItems.filter((s) => !localIds.has(s.id)).length,
      removedItems: local.filter((s) => !incomingIds.has(s.id)).length,
    };
  }

  async applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult> {
    const incomingItems = incoming.data as Snippet[];

    if (strategy === 'skip') {
      return { success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    if (strategy === 'replace') {
      snippetStore.clearAll();
      for (const item of incomingItems) {
        snippetStore.add(item);
      }
      return { success: true, itemsAdded: incomingItems.length, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    // merge
    const local = snippetStore.getAll();
    const localById = new Map(local.map((s) => [s.id, s]));
    let added = 0;
    let updated = 0;

    for (const item of incomingItems) {
      const existing = localById.get(item.id);
      if (!existing) {
        snippetStore.add(item);
        added++;
      } else if (item.createdAt > existing.createdAt) {
        snippetStore.update(item.id, item);
        updated++;
      }
    }

    return { success: true, itemsAdded: added, itemsUpdated: updated, itemsRemoved: 0, warnings: [] };
  }

  async getLocalSummary(): Promise<DataSummary> {
    const items = snippetStore.getAll();
    return { itemCount: items.length, label: `${items.length} snippet${items.length !== 1 ? 's' : ''}` };
  }
}
