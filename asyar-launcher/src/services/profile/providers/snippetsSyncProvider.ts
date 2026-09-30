import {
  snippetStore,
  type Snippet,
} from '../../../built-in-features/snippets/snippetStore.svelte';
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
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: snippetStore.getAll().filter((s) => !s.isPrivate),
    };
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const local = snippetStore.getAll();
    const incomingItems = incoming.data as Snippet[];
    const localSyncable = local.filter((s) => !s.isPrivate);
    const localIds = new Set(localSyncable.map((s) => s.id));
    const incomingIds = new Set(incomingItems.map((s) => s.id));

    return {
      localCount: local.length,
      incomingCount: incomingItems.length,
      conflicts: incomingItems.filter((s) => localIds.has(s.id)).length,
      newItems: incomingItems.filter((s) => !localIds.has(s.id)).length,
      removedItems: localSyncable.filter((s) => !incomingIds.has(s.id)).length,
    };
  }

  async applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult> {
    const incomingItems = incoming.data as Snippet[];

    if (strategy === 'skip') {
      return { success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    if (strategy === 'replace') {
      const localPrivate = snippetStore.getAll().filter((s) => s.isPrivate);
      snippetStore.clearAll();
      for (const item of incomingItems) {
        snippetStore.add(item);
      }
      for (const priv of localPrivate) {
        snippetStore.add(priv);
      }
      return {
        success: true,
        itemsAdded: incomingItems.length,
        itemsUpdated: 0,
        itemsRemoved: 0,
        warnings: [],
      };
    }

    // merge
    const local = snippetStore.getAll();
    const localById = new Map(local.map((s) => [s.id, s]));
    let added = 0;
    let updated = 0;

    for (const item of incomingItems) {
      const existing = localById.get(item.id);
      if (existing?.isPrivate) {
        continue;
      }
      if (!existing) {
        snippetStore.add(item);
        added++;
      } else if (item.createdAt > existing.createdAt) {
        snippetStore.update(item.id, item);
        updated++;
      }
    }

    return {
      success: true,
      itemsAdded: added,
      itemsUpdated: updated,
      itemsRemoved: 0,
      warnings: [],
    };
  }

  async getLocalSummary(): Promise<DataSummary> {
    const items = snippetStore.getAll();
    return {
      itemCount: items.length,
      label: `${items.length} snippet${items.length !== 1 ? 's' : ''}`,
    };
  }

  // ── Delta sync surface ──────────────────────────────────────────────────
  // Collection: one SyncItem per snippet keyed by snippet.id.

  async exportItems(): Promise<SyncItem[]> {
    return snippetStore
      .getAll()
      .filter(
        (snippet) => !snippet.isPrivate && snippet.expansion && snippet.expansion.trim() !== '',
      )
      .map((snippet) => ({
        id: snippet.id,
        categoryId: this.id,
        content: snippet,
      }));
  }

  async applyItemUpsert(item: SyncItem): Promise<void> {
    const incoming = item.content as Snippet;
    if (!incoming) return;
    const existing = snippetStore.getAll().find((s) => s.id === incoming.id);
    if (existing?.isPrivate) {
      return;
    }
    if (
      existing &&
      existing.expansion &&
      existing.expansion.trim() !== '' &&
      (!incoming.expansion || incoming.expansion.trim() === '')
    ) {
      return;
    }
    snippetStore.add(incoming);
  }

  async applyItemDelete(itemId: string): Promise<void> {
    const existing = snippetStore.getAll().find((s) => s.id === itemId);
    if (existing?.isPrivate) {
      return;
    }
    snippetStore.remove(itemId);
  }

  subscribeToChanges(callback: (event: SyncChangeEvent) => void): Unsubscribe {
    return snippetStore.subscribe((ev) => {
      if (ev.isPrivate) {
        return;
      }
      callback({ type: ev.type, itemId: ev.itemId, categoryId: this.id });
    });
  }
}
