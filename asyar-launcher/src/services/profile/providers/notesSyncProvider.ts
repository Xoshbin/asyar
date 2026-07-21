import { noteStore, type Note } from '../../../built-in-features/notes/noteStore.svelte';
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

export class NotesSyncProvider implements ISyncProvider {
  readonly id = 'notes';
  readonly displayName = 'Notes';
  readonly icon = 'icon:type';
  // 'core' matches every other registered provider — 'extended' has no
  // current user, so there's no precedent for placing a new feature there.
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'merge' as const;
  readonly sensitiveFields: string[] = [];

  async exportFull(): Promise<SyncProviderData> {
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: noteStore.getAll(),
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    return this.exportFull();
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const local = noteStore.getAll();
    const incomingItems = incoming.data as Note[];
    const localIds = new Set(local.map((n) => n.id));
    const incomingIds = new Set(incomingItems.map((n) => n.id));

    return {
      localCount: local.length,
      incomingCount: incomingItems.length,
      conflicts: incomingItems.filter((n) => localIds.has(n.id)).length,
      newItems: incomingItems.filter((n) => !localIds.has(n.id)).length,
      removedItems: local.filter((n) => !incomingIds.has(n.id)).length,
    };
  }

  async applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult> {
    const incomingItems = incoming.data as Note[];

    if (strategy === 'skip') {
      return { success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    if (strategy === 'replace') {
      // Notes intentionally has no clearAll — a "wipe every document" bulk
      // action doesn't exist in the UI either (see the plan doc); remove
      // existing items individually instead.
      const existingIds = noteStore.getAll().map((n) => n.id);
      for (const id of existingIds) noteStore.remove(id);
      for (const item of incomingItems) noteStore.add(item);
      return {
        success: true,
        itemsAdded: incomingItems.length,
        itemsUpdated: 0,
        itemsRemoved: existingIds.length,
        warnings: [],
      };
    }

    // merge — newest-edit-wins, using updatedAt (notes are edited
    // continuously, unlike snippets/shortcuts, so updatedAt is the
    // meaningful "which copy is newer" signal, not createdAt).
    const local = noteStore.getAll();
    const localById = new Map(local.map((n) => [n.id, n]));
    let added = 0;
    let updated = 0;

    for (const item of incomingItems) {
      const existing = localById.get(item.id);
      if (!existing) {
        noteStore.add(item);
        added++;
      } else if (item.updatedAt > existing.updatedAt) {
        noteStore.update(item.id, { title: item.title, body: item.body, pinned: item.pinned });
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
    const items = noteStore.getAll();
    return {
      itemCount: items.length,
      label: `${items.length} note${items.length !== 1 ? 's' : ''}`,
    };
  }

  // ── Delta sync surface ──────────────────────────────────────────────────
  // Collection: one SyncItem per note keyed by note.id.

  async exportItems(): Promise<SyncItem[]> {
    return noteStore.getAll().map((note) => ({
      id: note.id,
      categoryId: this.id,
      content: note,
    }));
  }

  async applyItemUpsert(item: SyncItem): Promise<void> {
    noteStore.add(item.content as Note);
  }

  async applyItemDelete(itemId: string): Promise<void> {
    noteStore.remove(itemId);
  }

  subscribeToChanges(callback: (event: SyncChangeEvent) => void): Unsubscribe {
    return noteStore.subscribe((ev) => {
      callback({ type: ev.type, itemId: ev.itemId, categoryId: this.id });
    });
  }
}
