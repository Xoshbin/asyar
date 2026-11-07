---
order: 8
---

## Contribute a Cloud & Remote File Search Provider to Asyar

Asyar features an extensible **File Search SPI (Service Provider Interface)** (`fileSearchProviders`) that allows Tier 2 extensions to contribute remote documents and cloud storage drives (**Google Drive, Notion, Dropbox, OneDrive, Box, Nextcloud, GitHub**) directly into Asyar's search results.

When an extension contributes a file search provider:

- It appears in **Settings → Built-in Features → File Search** under **Cloud & Remote File Search** with an enable/disable toggle.
- When the user searches in the launcher, local SSD files match instantly on frame 1 (0ms–5ms), and remote results stream in asynchronously without blocking the UI or dropping frames.
- Pressing `Enter` opens the remote document in the default web browser (or opens/reveals the local cached file if present).
- Pressing `⌘K` gives instant actions: **Open in Browser** (`Mod+O`), **Copy Web Link** (`Mod+Shift+L`), **Copy Markdown Link** (`Mod+Alt+L`), and **Send to Asyar AI** (`Mod+I`).

---

### Step 1 — Declare `fileSearchProviders` in `manifest.json`

Add `"network"` and `"files:search-provider"` to your `permissions` array, declare a background worker via `background.main`, and define your provider under `fileSearchProviders`:

```json
{
  "id": "org.example.gdrive",
  "name": "Google Drive",
  "version": "1.0.0",
  "description": "Search your Google Docs, Sheets, and cloud files in Asyar.",
  "permissions": ["network", "files:search-provider"],
  "background": {
    "main": "dist/worker.js"
  },
  "fileSearchProviders": [
    {
      "id": "gdrive",
      "name": "Google Drive",
      "description": "Search your Google Docs, Sheets, and Drive files.",
      "icon": "icon:google-drive",
      "requiresAuth": true,
      "defaultEnabled": true
    }
  ]
}
```

#### Manifest Fields Reference

| Field            | Type      | Required | Description                                                                |
| ---------------- | --------- | -------- | -------------------------------------------------------------------------- |
| `id`             | `string`  | ✅       | Unique provider identifier within your extension (`/^[a-z0-9_-]{1,64}$/`). |
| `name`           | `string`  | ✅       | Display label shown in Settings and as the result badge/category.          |
| `description`    | `string`  | ❌       | Subtitle / explanation displayed in Settings.                              |
| `icon`           | `string`  | ❌       | Icon name (e.g. `icon:globe`, `icon:folder`) or bundle asset.              |
| `requiresAuth`   | `boolean` | ❌       | Whether the provider requires an authenticated account to query.           |
| `defaultEnabled` | `boolean` | ❌       | Whether the provider is enabled by default upon extension installation.    |

---

### Step 2 — Register the search handler in your worker

In your background entrypoint (`src/worker.ts`), register your search handler using `context.files.registerFileSearchProvider`:

```typescript
import type { ExtensionContext } from 'asyar-sdk/worker';
import type { FileSearchQuery, FileSearchResultItem, INetworkService } from 'asyar-sdk/contracts';

export default class GoogleDriveExtension {
  async initialize(context: ExtensionContext): Promise<void> {
    const network = context.getService<INetworkService>('network');

    context.files.registerFileSearchProvider({
      id: 'gdrive',
      async search(query: FileSearchQuery, signal: AbortSignal): Promise<FileSearchResultItem[]> {
        // query.query: user search string
        // query.limit: max results requested (default 5)
        // signal: abort signal triggered when user continues typing or launcher dismisses

        const resp = await network.fetch(
          `https://www.googleapis.com/drive/v3/files?q=name+contains+'${encodeURIComponent(query.query)}'&pageSize=${query.limit}`,
          { signal },
        );

        if (!resp.ok) {
          throw new Error(`Google Drive API error: ${resp.status}`);
        }

        const data = await resp.json();
        return data.files.map((file: any) => ({
          id: file.id,
          title: file.name,
          container: file.parents ? 'Shared Drive' : 'My Drive',
          url: file.webViewLink,
          icon: file.mimeType.includes('spreadsheet') ? 'icon:table' : 'icon:document',
          mimeType: file.mimeType,
          modifiedAt: new Date(file.modifiedTime).getTime(),
        }));
      },
    });
  }
}
```

#### `FileSearchResultItem` Shape

```typescript
export interface FileSearchResultItem {
  /** Unique item identifier within this provider. */
  id: string;
  /** File title / name (e.g. "Q3 Financial Plan 2026"). */
  title: string;
  /** Subtitle or location hierarchy (e.g. "Finance / Shared Drive"). */
  container?: string;
  /** Remote web URL to open the document (e.g. Google Docs URL). */
  url?: string;
  /** Optional local disk path if mirrored or cached locally. */
  path?: string;
  /**
   * Standard icon key (e.g. "icon:document", "icon:link") or an `https://` URL.
   * Remote icons are fetched by the host and require the `network` permission.
   */
  icon?: string;
  /** MIME type (e.g. "application/vnd.google-apps.spreadsheet"). */
  mimeType?: string;
  /** Timestamp of last modification in epoch milliseconds. */
  modifiedAt?: number;
  /** File size in bytes. */
  size?: number;
}
```

---

### Step 3 — Performance & Cancellation Guidelines

- **Zero-IPC Fast Path**: Asyar queries remote file providers with a 200ms debounce. Local SSD search results are rendered immediately without waiting for remote network calls.
- **Respect `signal`**: As the user types, previous pending search requests are automatically aborted via the passed `AbortSignal`. Forward this signal to `fetch` calls so stale in-flight network requests terminate promptly.
- **Fail Gracefully**: If your API encounters an error or network timeout (Asyar applies a 4000ms deadline), reject or return an empty array. Remote errors do not interrupt local file search.
