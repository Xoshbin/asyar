import { clipboardHistoryStore } from '../../clipboard/stores/clipboardHistoryStore.svelte';
import { stripHtml, stripRtf, type ClipboardHistoryItem } from 'asyar-sdk';
import type { ISyncProvider, SyncProviderData, BinaryAsset, ImportPreview, ImportResult, DataSummary, ConflictStrategy } from '../types';

export class ClipboardSyncProvider implements ISyncProvider {
  readonly id = 'clipboard';
  readonly displayName = 'Clipboard History';
  readonly icon = 'clipboard';
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'merge' as const;
  readonly sensitiveFields: string[] = [];

  async exportFull(): Promise<SyncProviderData> {
    const items = await clipboardHistoryStore.getHistoryItems();
    const binaryAssets: BinaryAsset[] = [];

    for (const item of items) {
      if (item.type === 'image') {
        binaryAssets.push({
          id: item.id,
          filename: `${item.id}.png`,
          mimeType: 'image/png',
          archivePath: `assets/clipboard/${item.id}.png`,
        });
      }
    }

    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: items,
      binaryAssets: binaryAssets.length > 0 ? binaryAssets : undefined,
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    const items = await clipboardHistoryStore.getHistoryItems();
    const exported = items
      .filter(item => item.type !== 'image')
      .map(item => {
        if (item.type === 'html' && item.content) {
          return { ...item, type: 'text' as ClipboardHistoryItem['type'], content: stripHtml(item.content) };
        }
        if (item.type === 'rtf' && item.content) {
          return { ...item, type: 'text' as ClipboardHistoryItem['type'], content: stripRtf(item.content) };
        }
        return item;
      });
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: exported,
    };
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const local = await clipboardHistoryStore.getHistoryItems();
    const incomingItems = incoming.data as ClipboardHistoryItem[];
    const localIds = new Set(local.map(i => i.id));
    const incomingIds = new Set(incomingItems.map(i => i.id));

    return {
      localCount: local.length,
      incomingCount: incomingItems.length,
      conflicts: incomingItems.filter(i => localIds.has(i.id)).length,
      newItems: incomingItems.filter(i => !localIds.has(i.id)).length,
      removedItems: local.filter(i => !incomingIds.has(i.id)).length,
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

    // merge: dedup by id, add new items only
    const local = await clipboardHistoryStore.getHistoryItems();
    const localIds = new Set(local.map(i => i.id));
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
    const items = await clipboardHistoryStore.getHistoryItems();
    return { itemCount: items.length, label: `${items.length} clipboard item(s)` };
  }
}
