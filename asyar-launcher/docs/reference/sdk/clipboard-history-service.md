### 8.3 `ClipboardHistoryService` — Full clipboard access

**Permission required:** `clipboard:read` for reads, `clipboard:write` for writes.

```typescript
interface IClipboardHistoryService {
  // Read
  readCurrentClipboard(): Promise<{ type: ClipboardItemType; content: string }>;
  getRecentItems(limit?: number): Promise<ClipboardHistoryItem[]>;

  // Write
  writeToClipboard(item: ClipboardHistoryItem): Promise<void>;
  pasteItem(item: ClipboardHistoryItem): Promise<void>;
  simulatePaste(): Promise<boolean>;

  // Manage history
  toggleItemFavorite(itemId: string): Promise<boolean>;
  deleteItem(itemId: string): Promise<boolean>;
  clearNonFavorites(): Promise<boolean>;

  // Utilities
  formatClipboardItem(item: ClipboardHistoryItem): string;
  normalizeImageData(content: string): string;
  isValidImageData(content: string): boolean;
  initialize(): Promise<void>;
  stopMonitoring(): void;
  hideWindow(): Promise<void>;
}

// Clipboard item types
enum ClipboardItemType {
  Text  = 'text',
  Html  = 'html',
  Image = 'image',
}

interface ClipboardHistoryItem {
  id: string;
  type: ClipboardItemType;
  content?: string;
  preview?: string;
  createdAt: number;
  favorite: boolean;
}
```

**Usage:**
```typescript
const clip = context.getService<IClipboardHistoryService>('ClipboardHistoryService');

// Read what is currently on the clipboard
const current = await clip.readCurrentClipboard();
if (current.type === 'text') {
  console.log(current.content);
}

// Get the 20 most recent clipboard history items
const items = await clip.getRecentItems(20);

// Write a new text item to the clipboard
await clip.writeToClipboard({
  id: crypto.randomUUID(),
  type: ClipboardItemType.Text,
  content: 'Hello from my extension',
  createdAt: Date.now(),
  favorite: false,
});

// Paste an item by simulating keyboard paste
await clip.pasteItem(items[0]);

// Favorite/unfavorite an item (survives clearNonFavorites)
const isFavorite = await clip.toggleItemFavorite(items[0].id);

// Delete a specific item
await clip.deleteItem(items[0].id);

// Check if a content string is valid base64 image data
if (clip.isValidImageData(someContent)) {
  const normalized = clip.normalizeImageData(someContent);
}
```

---
