### 8.34 `FilesService` — Search the local file index

**Runs in:** both worker and view.

**Permission required:** `files:search`.

The same bounded, cached file index that backs the host's own "Search
Files" view — your extension gets the identical search capability, not a
separate implementation. Search is a per-keystroke-safe operation (bounded
work regardless of index size); it does not read file contents.

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

interface IFilesService {
  /** Bounded per-keystroke query against the local file index. */
  search(query: string, opts?: FileSearchOptions): Promise<FileHit[]>;
  /** Current index lifecycle state — useful for showing a "still indexing" hint. */
  status(): Promise<IndexStatus>;
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

Note the surface is deliberately small: `search`/`status` only. There is
no read/write/delete here — for reading file content use the OS-level
file APIs your extension already has access to (subject to the platform's
own file-access permissions), and for file *operations* (reveal in file
manager, trash) see [`FileManagerService`](./file-manager-service.md).

---
