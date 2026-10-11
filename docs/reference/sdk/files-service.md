### 8.34 `FilesService` — Search the local file index, read declared files

**Runs in:** both worker and view.

**Permission required:** `files:search` for `search`/`status`;
`files:read` for `read`/`readRange`/`glob`/`thumbnail`.

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

Two companions share `read`'s permission and scope, because each is
strictly less information than the byte read already granted. `glob`
enumerates existing in-scope files matching a pattern — for names that
can't be known in advance, like content-addressed cache files
(`librarycache/<appid>/<sha1>.jpg`). `thumbnail` returns an
`asyar-thumb://` URL for an in-scope image, generated and cached by the
same pipeline the launcher's own file previews use — set it directly as a
dynamic command's `icon` and it renders like the launcher's native
application icons. Extension thumbnails are images-only by design, so the
result is identical on Windows, macOS, and Linux: any non-image resolves
`null` rather than falling back to per-OS preview generators.

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

interface FileGlobOptions {
  /** Applied after filtering and sorting. Default and ceiling: 256. */
  maxResults?: number;
  sort?: 'path' | 'modified-desc'; // default: path
  modifiedAfterMs?: number; // exclusive lower bound, Unix milliseconds
  modifiedBeforeMs?: number; // exclusive upper bound, Unix milliseconds
}

interface GlobEntry {
  path: string;
  size: number; // bytes
  mtimeMs: number; // Unix milliseconds
}

interface FileReadRangeOptions {
  maxBytes?: number; // default: 65,536; ceiling: 1 MiB
  offset?: number; // byte offset, default: 0
  fromEnd?: boolean; // last maxBytes bytes; cannot combine with offset
  align?: 'none' | 'line'; // default: line
}

interface FileChunk {
  text: string;
  start: number; // first emitted byte (after alignment)
  end: number; // next byte offset to request
  size: number; // file size in bytes at read time
  mtimeMs: number; // Unix milliseconds
  eof: boolean;
}

interface FileThumbnailOptions {
  /** Longest edge of the generated thumbnail in pixels. Defaults to 256;
   * the host clamps to 16–512. */
  maxDim?: number;
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
  readRange(path: string, opts?: FileReadRangeOptions): Promise<FileChunk>;
  /** Enumerate existing in-scope files matching a glob. The pattern must
   * begin with an absolute literal prefix to walk from
   * (`C:/Steam/appcache/**` works; a leading `**` doesn't). Returns
   * metadata for regular files only, filtered to the declared
   * scope minus the deny-list; symlinks are neither followed nor
   * reported. A missing walk root (an unplugged library drive) resolves
   * to `[]`; a pattern outside the declared scope rejects. */
  glob(pattern: string, opts?: FileGlobOptions): Promise<GlobEntry[]>;
  /** Thumbnail of an in-scope file as an `asyar-thumb://` URL, usable
   * directly as a dynamic command's `icon`. Images only, identical on
   * every platform: non-image types resolve `null`. Rejects on scope
   * denials. */
  thumbnail(path: string, opts?: FileThumbnailOptions): Promise<string | null>;
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

**Real artwork on dynamic commands** — enumerate a content-addressed cache
with `glob`, thumbnail the hit, use the URL as the command's `icon`:

```json
{
  "permissions": ["files:read"],
  "permissionArgs": {
    "files:read": ["C:/Program Files (x86)/Steam/appcache/librarycache/**"]
  }
}
```

```typescript
// Steam's square icon is sha1-named — unknowable in advance, but 40 `?`s
// match the hex name precisely:
const hits = await files.glob(
  `C:/Program Files (x86)/Steam/appcache/librarycache/${appid}/${'?'.repeat(40)}.jpg`,
);
if (hits.length > 0) {
  const icon = await files.thumbnail(hits[0].path, { maxDim: 64 });
  // → 'asyar-thumb://localhost/<key>.png', ready for dynamic command registration
}
```

### Range reads and incremental tails

`readRange` uses exactly the same scope, protected-location checks, and
symlink re-check as `read`; `read` itself is unchanged. Offsets and sizes
are **bytes**, not JavaScript string indices. `fromEnd: true` selects the
last `maxBytes` bytes. Supplying both `offset` and `fromEnd: true` rejects.
An offset beyond EOF returns empty text, `start = end = size`, and `eof: true`.

Default `align: 'line'` drops a partial leading line (unless the preceding
byte is a newline), and a partial trailing line unless the window reaches
EOF. A window without a complete line returns empty text but advances `end`
to the window end, so oversized lines cannot stall a reader. `align: 'none'`
trims incomplete UTF-8 codepoints at the window edges; invalid interior
bytes still decode lossily. A fully stripped window also advances `end`.

Store `end`, not `start + text.length`, for incremental reads. If
`size < lastEnd`, the file was rotated/truncated: reset and read from zero.
This detects shrinking files, not replacement by an equal-sized or larger
file; `mtimeMs` is metadata, not a file identity token.

```typescript
let lastEnd = 0;

async function pollLog(path: string) {
  let chunk = await files.readRange(path, { offset: lastEnd });
  if (chunk.size < lastEnd) {
    lastEnd = 0;
    chunk = await files.readRange(path, { offset: 0 });
  }
  lastEnd = chunk.end;
  consumeLogText(chunk.text);
}
```

At EOF an unterminated line is emitted as-is; a later append may therefore
continue a previously emitted line. Consumers requiring complete log records
should buffer that final fragment themselves.

### Glob sorting, filtering, and keyset paging

`glob` now returns `GlobEntry[]`, not strings. `sort: 'path'` is the default;
`'modified-desc'` returns newest files first, with path ordering for equal
millisecond mtimes. `modifiedAfterMs` and `modifiedBeforeMs` are exclusive.
The result cap (default/ceiling 256) applies **after** filtering and sorting.
Non-`**` patterns do not descend beyond their component count. Recursive
walks have a 100,000-entry budget; exceeding it rejects rather than silently
returning an incomplete page. Narrow the literal prefix on that error.

```typescript
let modifiedBeforeMs: number | undefined;
for (;;) {
  const page = await files.glob('/absolute/logs/**/*.log', {
    sort: 'modified-desc',
    maxResults: 100,
    modifiedBeforeMs,
  });
  if (page.length === 0) break;
  consumeEntries(page);
  modifiedBeforeMs = page[page.length - 1].mtimeMs;
}
```

**Ties:** this cursor is an mtime-only keyset, not a composite path/mtime
cursor. If a page cuts through a group with the same millisecond mtime,
the next exclusive `modifiedBeforeMs` skips the remaining ties. Use a larger
cap or narrower patterns/time ranges when every tied file matters; no
lossless pagination guarantee is made for same-ms ties or concurrent changes.

Note the surface is deliberately read-shaped: `search`/`status`/`read`/`readRange`/
`glob`/`thumbnail` only. There is no write/delete here — for file
_operations_ (reveal in file manager, trash) see
[`FileManagerService`](./file-manager-service.md).

---
