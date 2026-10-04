import { type UnlistenFn } from '@tauri-apps/api/event';
import {
  noteGetAllForService,
  noteRemove,
  noteUpdate,
  noteUpsert,
  type StoredNote,
} from '../../../lib/ipc/commands';
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
import { appListen } from '../../../lib/ipc/bridgeEvents';

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
      data: await noteGetAllForService(),
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    return this.exportFull();
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const local = await noteGetAllForService();
    const incomingItems = incoming.data as StoredNote[];
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
    const incomingItems = incoming.data as StoredNote[];

    if (strategy === 'skip') {
      return { success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    if (strategy === 'replace') {
      // Notes intentionally has no clearAll — a "wipe every document" bulk
      // action doesn't exist in the UI either (see the plan doc); remove
      // existing items individually instead.
      const existingIds = (await noteGetAllForService()).map((n) => n.id);
      for (const id of existingIds) await noteRemove(id);
      for (const item of incomingItems) await noteUpsert(item);
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
    const local = await noteGetAllForService();
    const localById = new Map(local.map((n) => [n.id, n]));
    let added = 0;
    let updated = 0;

    for (const item of incomingItems) {
      const existing = localById.get(item.id);
      if (!existing) {
        await noteUpsert(item);
        added++;
      } else if (item.updatedAt > existing.updatedAt) {
        await noteUpdate(
          item.id,
          { title: item.title, body: item.body, pinned: item.pinned },
          item.updatedAt,
        );
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
    const items = await noteGetAllForService();
    return {
      itemCount: items.length,
      label: `${items.length} note${items.length !== 1 ? 's' : ''}`,
    };
  }

  // ── Delta sync surface ──────────────────────────────────────────────────
  // Collection: one SyncItem per note keyed by note.id.

  async exportItems(): Promise<SyncItem[]> {
    return (await noteGetAllForService()).map((note) => ({
      id: note.id,
      categoryId: this.id,
      content: note,
    }));
  }

  async applyItemUpsert(item: SyncItem): Promise<void> {
    await noteUpsert(item.content as StoredNote);
  }

  async applyItemDelete(itemId: string): Promise<void> {
    await noteRemove(itemId);
  }

  subscribeToChanges(callback: (event: SyncChangeEvent) => void): Unsubscribe {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void appListen<{ id: string; type: 'upsert' | 'delete' }>('notes:changed', (event) => {
      if (disposed) return;
      callback({ type: event.payload.type, itemId: event.payload.id, categoryId: this.id });
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }
}
