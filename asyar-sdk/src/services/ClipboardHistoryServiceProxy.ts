import type { IClipboardHistoryService } from "./IClipboardHistoryService";
import type { ClipboardHistoryItem } from "../types";
import { ClipboardItemType } from "../types";
import { BaseServiceProxy } from "./BaseServiceProxy";

export class ClipboardHistoryServiceProxy extends BaseServiceProxy implements IClipboardHistoryService {
  initialize(): Promise<void> {
    return this.broker.invoke<void>('clipboard:initialize');
  }

  stopMonitoring(): void {
    this.broker.invoke('clipboard:stopMonitoring').catch(console.error);
  }

  formatClipboardItem(item: ClipboardHistoryItem): string {
    if (item.type === ClipboardItemType.Text || item.type === ClipboardItemType.Html) {
      return item.content || '';
    }
    if (item.type === ClipboardItemType.Rtf) {
      return item.content || '[RTF item]';
    }
    if (item.type === ClipboardItemType.Files) {
      try {
        const paths = JSON.parse(item.content || '[]');
        return `[${paths.length} file${paths.length !== 1 ? 's' : ''}]`;
      } catch {
        return '[Files]';
      }
    }
    return `[${item.type} item]`;
  }

  pasteItem(item: ClipboardHistoryItem): Promise<void> {
    return this.broker.invoke<void>('clipboard:pasteItem', { item });
  }

  hideWindow(): Promise<void> {
    return this.broker.invoke<void>('clipboard:hideWindow');
  }

  simulatePaste(): Promise<boolean> {
    return this.broker.invoke<boolean>('clipboard:simulatePaste');
  }

  writeToClipboard(item: ClipboardHistoryItem): Promise<void> {
    return this.broker.invoke<void>('clipboard:writeToClipboard', { item });
  }

  getRecentItems(limit?: number): Promise<ClipboardHistoryItem[]> {
    return this.broker.invoke<ClipboardHistoryItem[]>('clipboard:getRecentItems', { limit });
  }

  toggleItemFavorite(itemId: string): Promise<boolean> {
    return this.broker.invoke<boolean>('clipboard:toggleItemFavorite', { itemId });
  }

  deleteItem(itemId: string): Promise<boolean> {
    return this.broker.invoke<boolean>('clipboard:deleteItem', { itemId });
  }

  clearNonFavorites(): Promise<boolean> {
    return this.broker.invoke<boolean>('clipboard:clearNonFavorites');
  }

  normalizeImageData(content: string): string {
    if (content.startsWith('data:image')) return content;
    return `data:image/png;base64,${content}`;
  }

  isValidImageData(content: string): boolean {
    return content.startsWith('data:image') || /^[A-Za-z0-9+/=]+$/.test(content);
  }

  readCurrentClipboard(): Promise<{ type: ClipboardItemType; content: string }> {
    return this.broker.invoke<{ type: ClipboardItemType; content: string }>('clipboard:readCurrentClipboard');
  }

  readCurrentText(): Promise<string> {
    return this.broker.invoke<string>('clipboard:readCurrentText');
  }
}

