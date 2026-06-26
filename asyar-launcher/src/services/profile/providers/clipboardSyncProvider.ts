import {
  clipboardExportForSync,
  clipboardCount,
  type StoredClipboardItem,
  type ClipboardCursor,
} from '../../../lib/ipc/commands';
import { clipboardHistoryStore } from '../../clipboard/stores/clipboardHistoryStore.svelte';
import { stripHtml, stripRtf, type ClipboardHistoryItem } from 'asyar-sdk/contracts';
import type {
  ISyncProvider,
  SyncProviderData,
  BinaryAsset,
  ImportPreview,
  ImportResult,
  DataSummary,
  ConflictStrategy,
  SyncItem,
  SyncChangeEvent,
  Unsubscribe,
} from '../types';

const SYNC_PAGE_SIZE = 500;

async function collectAllItems(): Promise<StoredClipboardItem[]> {
  const all: StoredClipboardItem[] = [];
  let cursor: ClipboardCursor | undefined;
  do {
    const page = await clipboardExportForSync(cursor, SYNC_PAGE_SIZE);
    if (page === null) {
      throw new Error('clipboard_export_for_sync failed');
    }
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

export class ClipboardSyncProvider implements ISyncProvider {
  readonly id = 'clipboard';
  readonly displayName = 'Clipboard History';
  readonly icon = 'clipboard';
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'merge' as const;
  readonly sensitiveFields: string[] = [];

  async exportFull(): Promise<SyncProviderData> {
    const items = await collectAllItems();
    const binaryAssets: BinaryAsset[] = items
      .filter((i) => i.type === 'image')
      .map((i) => ({
        id: i.id,
        filename: `${i.id}.png`,
        mimeType: 'image/png',
        archivePath: `assets/clipboard/${i.id}.png`,
      }));
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: items as unknown as ClipboardHistoryItem[],
      binaryAssets: binaryAssets.length > 0 ? binaryAssets : undefined,
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    const items = await collectAllItems();
    const exported = items
      .filter((i) => i.type !== 'image')
      .map((i) => {
        if (i.type === 'html' && i.content) {
          return { ...i, type: 'text' as const, content: stripHtml(i.content) };
        }
        if (i.type === 'rtf' && i.content) {
          return { ...i, type: 'text' as const, content: stripRtf(i.content) };
        }
        return i;
      });
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: exported as unknown as ClipboardHistoryItem[],
    };
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const summary = await clipboardCount();
    if (summary === null) {
      throw new Error('clipboard_count failed');
    }
    const localCount = summary.total;
    const incomingItems = incoming.data as ClipboardHistoryItem[];
    const incomingIds = new Set(incomingItems.map((i) => i.id));
    const local = await collectAllItems();
    const localIds = new Set(local.map((i) => i.id));

    return {
      localCount,
      incomingCount: incomingItems.length,
      conflicts: incomingItems.filter((i) => localIds.has(i.id)).length,
      newItems: incomingItems.filter((i) => !localIds.has(i.id)).length,
      removedItems: local.filter((i) => !incomingIds.has(i.id)).length,
    };
  }

  async applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult> {
    const incomingItems = incoming.data as ClipboardHistoryItem[];

    if (strategy === 'skip') {
      return { success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    if (strategy === 'replace') {
      await clipboardHistoryStore.clearHistory();
      for (const item of incomingItems) {
        await clipboardHistoryStore.addHistoryItem(item);
      }
      return { success: true, itemsAdded: incomingItems.length, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    const local = await collectAllItems();
    const localIds = new Set(local.map((i) => i.id));
    let added = 0;
    for (const item of incomingItems) {
      if (!localIds.has(item.id)) {
        await clipboardHistoryStore.addHistoryItem(item);
        added++;
      }
    }
    return { success: true, itemsAdded: added, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
  }

  async getLocalSummary(): Promise<DataSummary> {
    const c = await clipboardCount();
    if (c === null) {
      throw new Error('clipboard_count failed');
    }
    return { itemCount: c.total, label: `${c.total} clipboard item(s)` };
  }

  async exportItems(): Promise<SyncItem[]> {
    const items = await collectAllItems();
    return items
      .filter((i) => i.type !== 'image')
      .map((i) => ({ id: i.id, categoryId: this.id, content: i as unknown as ClipboardHistoryItem }));
  }

  async applyItemUpsert(item: SyncItem): Promise<void> {
    await clipboardHistoryStore.addHistoryItem(item.content as ClipboardHistoryItem);
  }

  async applyItemDelete(itemId: string): Promise<void> {
    await clipboardHistoryStore.deleteHistoryItem(itemId);
  }

  subscribeToChanges(callback: (event: SyncChangeEvent) => void): Unsubscribe {
    return clipboardHistoryStore.subscribe((ev) => {
      callback({ type: ev.type, itemId: ev.itemId, categoryId: this.id });
    });
  }
}
