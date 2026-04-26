### 8.3 `ClipboardHistoryService` — Full clipboard access

**Runs in:** view only. Clipboard reads/writes are tied to user interaction
and live in the view's proxy bag.

**Permission required:** `clipboard:read` for reads, `clipboard:write` for writes.

```typescript
interface IClipboardHistoryService {
  // Read
  readCurrentClipboard(): Promise<{ type: ClipboardItemType; content: string }>;
  readCurrentText(): Promise<string>;
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
  Rtf   = 'rtf',
  Image = 'image',
  Files = 'files',
}

// Optional metadata captured with the item (shape depends on type)
interface ClipboardItemMetadata {
  width?: number;       // Image items
  height?: number;      // Image items
  fileCount?: number;   // Files items
  fileNames?: string[]; // Files items
  sizeBytes?: number;
  mimeType?: string;
}

// Source application info captured at copy time.
// bundleId is set on macOS; path is set on Windows/Linux (and macOS bundle path).
// iconUrl is resolved from the icon cache at capture time — may be absent.
interface ClipboardSourceApp {
  name: string;
  bundleId?: string;
  path?: string;
  windowTitle?: string;
  iconUrl?: string;
}

interface ClipboardHistoryItem {
  id: string;
  type: ClipboardItemType;
  content?: string;
  preview?: string;
  createdAt: number;
  favorite: boolean;
  metadata?: ClipboardItemMetadata;
  sourceApp?: ClipboardSourceApp;
}
```

**Usage:**
```typescript
const clip = context.getService<IClipboardHistoryService>('clipboard');

// Read what is currently on the clipboard (format-aware)
const current = await clip.readCurrentClipboard();
if (current.type === 'text') {
  console.log(current.content);
}

// Read the current clipboard as plain text, regardless of flavor (HTML/RTF/files
// are coerced to their text representation). Useful when feeding clipboard
// content into search, URL templates, or snippets.
const text = await clip.readCurrentText();

// Get the 20 most recent clipboard history items
const items = await clip.getRecentItems(20);

// Each item may carry the app it was copied from (name + icon + window title).
// Useful for building filters ("show only items from Chrome") or for providing
// richer UI in clipboard-manager extensions.
for (const item of items) {
  if (item.sourceApp) {
    console.log(`${item.preview} — from ${item.sourceApp.name}`);
  }
}

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
