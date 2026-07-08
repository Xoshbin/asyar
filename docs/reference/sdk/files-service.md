### 8.34 `FilesService` — Search the local file index, read declared files

**Runs in:** both worker and view.

**Permission required:** `files:search` for `search`/`status`;
`files:read` for `read`.

The same bounded, cached file index that backs the host's own "Search
Files" view — your extension gets the identical search capability, not a
separate implementation. Search is a per-keystroke-safe operation (bounded
work regardless of index size); it does not read file contents.

For file _contents_ there is `read`: a bounded text read scoped to the
glob patterns your manifest declares in `permissionArgs["files:read"]`.
Those patterns are the entire readable scope — nothing outside them is
readable, and credential stores (`~/.ssh`, `~/.aws`, …) and OS locations
are denied even when a pattern covers them. The declared patterns are
shown to the user in the install/enable permission prompt. Unlike
`fs:watch` patterns, they may anchor anywhere — another drive
(`C:/Program Files (x86)/Steam/**`) or nowhere at all
(`**/steamapps/appmanifest_*.acf`, which covers the file on every drive).

```typescript
type FileType = 'document' | 'image' | 'code' | 'audio-video' | 'archive' | 'folder' | 'other';
type HitSource = 'local' | 'deep';

interface FileHit {
  fileId: string;
  name: string;
  path: string;
  type: FileType;
  isDir: boolean;
  modifiedAt: number; // unix seconds
  score: number;
  pinned: boolean;
  source: HitSource;
}

interface FileSearchOptions {
  typeFilter?: FileType;
  limit?: number;
}

type IndexStateKind = 'disabled' | 'building' | 'ready' | 'rescanning' | 'cap-reached';

interface IndexStatus {
  state: IndexStateKind;
  entryCount: number;
  lastScanMs: number;
  snapshotLoaded: boolean;
  capReached: boolean;
}

interface FileReadOptions {
  /** Read at most this many bytes (lossy UTF-8). Defaults to 50,000; the
   * host clamps extension reads to a 1 MiB ceiling regardless. */
  maxBytes?: number;
}

interface IFilesService {
  /** Bounded per-keystroke query against the local file index. */
  search(query: string, opts?: FileSearchOptions): Promise<FileHit[]>;
  /** Current index lifecycle state — useful for showing a "still indexing" hint. */
  status(): Promise<IndexStatus>;
  /** Bounded text read of an absolute path covered by the extension's
   * declared `permissionArgs["files:read"]` globs. Rejects with the
   * denial reason when the path is out of scope or protected. */
  read(path: string, opts?: FileReadOptions): Promise<string>;
}
```

**Usage:**

```typescript
const files = context.getService<IFilesService>('files');

// Check whether the index is ready before relying on complete results
const status = await files.status();
if (status.state === 'building' || status.state === 'rescanning') {
  console.log('Index still catching up — results may be incomplete');
}

// Search, optionally filtered to one file type
const hits = await files.search('invoice', { typeFilter: 'document', limit: 20 });
for (const hit of hits) {
  console.log(`${hit.name} — ${hit.path}`);
}
```

**Declaring a read scope** (manifest):

```json
{
  "permissions": ["files:read"],
  "permissionArgs": {
    "files:read": ["**/steamapps/libraryfolders.vdf", "**/steamapps/appmanifest_*.acf"]
  }
}
```

```typescript
// Reads succeed only for paths a declared pattern covers:
const vdf = await files.read('C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf');
// Out-of-scope or protected paths reject with the denial reason:
await files.read('C:/Users/me/.ssh/id_rsa'); // → rejects
```

Note the surface is deliberately small: `search`/`status`/`read` only.
There is no write/delete here — for file _operations_ (reveal in file
manager, trash) see [`FileManagerService`](./file-manager-service.md).

---
