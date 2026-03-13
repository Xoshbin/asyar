import { IClipboardHistoryService } from "./IClipboardHistoryService";
import { MessageBroker } from "../ipc/MessageBroker";
import { ClipboardHistoryItem, ClipboardItemType } from "../types";

export class ClipboardHistoryServiceProxy implements IClipboardHistoryService {
  private broker: MessageBroker;

  constructor() {
    this.broker = MessageBroker.getInstance();
  }

  initialize(): Promise<void> {
    return this.broker.invoke<void>('clipboard:initialize');
  }

  stopMonitoring(): void {
    this.broker.invoke('clipboard:stopMonitoring').catch(console.error);
  }

  // Note: formatClipboardItem seems like a synchronous formatting task.
  // It might be better executed directly if it's purely formatting text,
  // but if it relies on backend state, we proxy it. Assuming proxy to be safe.
  formatClipboardItem(item: ClipboardHistoryItem): string {
    // If it's a synchronous method in the interface and we must return a string immediately,
    // we can't use an async IPC call easily unless we change the interface.
    // However, looking at the interface: `formatClipboardItem(item: ClipboardHistoryItem): string;`
    // I'll implement a basic formatting here, as making it async breaks the interface.
    if (item.type === ClipboardItemType.Text || item.type === ClipboardItemType.Html) {
      return item.content || '';
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
    // Synchronous method.
    if (content.startsWith('data:image')) return content;
    return `data:image/png;base64,${content}`;
  }

  isValidImageData(content: string): boolean {
    // Synchronous method.
    return content.startsWith('data:image') || /^[A-Za-z0-9+/=]+$/.test(content);
  }

  readCurrentClipboard(): Promise<{ type: ClipboardItemType; content: string }> {
    return this.broker.invoke<{ type: ClipboardItemType; content: string }>('clipboard:readCurrentClipboard');
  }
}
