import type {
  FileReadRangeOptions,
  FileChunk,
  FileGlobOptions,
  FileGlobEntriesOptions,
  FileGlobEntry,
} from '../generated/files';
import type { FileSearchProviderRegistration } from '../contracts/fileSearch';
export type { FileSearchProviderRegistration } from '../contracts/fileSearch';
export type {
  FileReadRangeOptions,
  ReadAlign,
  FileChunk,
  FileGlobOptions,
  FileGlobEntriesOptions,
  FileGlobEntry,
  GlobSort,
} from '../generated/files';

export type FileType =
  'document' | 'image' | 'code' | 'audio-video' | 'archive' | 'folder' | 'other';

export type HitSource = 'local' | 'deep';

export interface FileHit {
  fileId: string;
  name: string;
  path: string;
  type: FileType;
  isDir: boolean;
  modifiedAt: number;
  score: number;
  pinned: boolean;
  source: HitSource;
}

export interface WorkMeter {
  bytesScanned: number;
  candidatesCollected: number;
  candidatesScored: number;
  fuzzyChecks: number;
  narrowed: boolean;
}

export interface FileSearchResponse {
  hits: FileHit[];
  truncated: boolean;
  scannedAll: boolean;
  indexGeneration: number;
  work: WorkMeter;
}

export type IndexStateKind = 'disabled' | 'building' | 'ready' | 'rescanning' | 'cap-reached';

export interface IndexStatus {
  state: IndexStateKind;
  entryCount: number;
  lastScanMs: number;
  snapshotLoaded: boolean;
  capReached: boolean;
}

export interface FileSearchOptions {
  typeFilter?: FileType;
  limit?: number;
}

export interface FileReadOptions {
  /** Read at most this many bytes (lossy UTF-8). Defaults to 50,000; the
   * host clamps extension reads to a 1 MiB ceiling regardless. */
  maxBytes?: number;
}

export interface FileThumbnailOptions {
  /** Longest edge of the generated thumbnail in pixels. Defaults to 256;
   * the host clamps to 16–512. */
  maxDim?: number;
}

/**
 * Generic file-search capability, exposed to Tier 2 extensions through the
 * same `files:*` wire namespace the Tier 1 "Search Files" view itself
 * consumes host-side. `search`/`status` require `files:search`;
 * `read`/`readRange`/`glob`/`thumbnail` require `files:read`.
 */
export interface IFilesService {
  /** Bounded per-keystroke query against the local file index. */
  search(query: string, opts?: FileSearchOptions): Promise<FileHit[]>;
  /** Current index lifecycle state — useful for showing a "still indexing" hint. */
  status(): Promise<IndexStatus>;
  /**
   * Bounded text read of an absolute path. Requires the `files:read`
   * permission, and the path must match one of the glob patterns the
   * extension declared in `permissionArgs["files:read"]` — those patterns
   * are the entire readable scope (shown to the user at install/enable
   * time). Credential stores (`~/.ssh`, `~/.aws`, …) and OS locations are
   * denied even when a declared pattern covers them. Rejects (with the
   * denial reason) rather than resolving empty when access is refused.
   */
  read(path: string, opts?: FileReadOptions): Promise<string>;
  /**
   * Check whether a file or directory exists at `path`. Enforces the exact
   * same `files:read` permission, declared-glob scope, deny-list, and
   * symlink/canonicalization checks as `read`: resolves `false` when the
   * target is missing but in scope, `true` when it exists and is in scope,
   * and rejects when out of scope or denied.
   */
  exists(path: string): Promise<boolean>;
  /** Bounded range/tail read, line-aligned by default. Requires files:read. */
  readRange(path: string, opts?: FileReadRangeOptions): Promise<FileChunk>;
  /**
   * Enumerate existing files matching a glob, within the same `files:read`
   * scope as `read` — for names that can't be known in advance, like
   * content-addressed cache files (`librarycache/<appid>/<sha1>.jpg`).
   * The pattern must begin with an absolute literal prefix to walk from
   * (`C:/Steam/appcache/**` works; a leading `**` doesn't). Returns
   * absolute paths of regular files only, sorted, capped, filtered to the
   * declared scope minus the deny-list; symlinks are neither followed nor
   * reported. A missing walk root (e.g. an unplugged library drive)
   * resolves to `[]`; a pattern outside the declared scope rejects.
   */
  glob(pattern: string, opts?: FileGlobOptions): Promise<string[]>;
  /** Metadata enumeration with time filters and sorting. Same files:read scope as glob. */
  globEntries(pattern: string, opts?: FileGlobEntriesOptions): Promise<FileGlobEntry[]>;
  /**
   * Thumbnail of an absolute path as an `asyar-thumb://` URL, generated
   * and cached by the same pipeline the launcher's own file previews use —
   * usable directly as a dynamic command's `icon`. Same `files:read`
   * scope rules as `read`. Images only, deliberately identical on every
   * platform: non-image types resolve `null` (the same "no strategy"
   * signal), never a platform-dependent result. Rejects on scope denials.
   */
  thumbnail(path: string, opts?: FileThumbnailOptions): Promise<string | null>;
  /**
   * Native OS file, folder, or app icon for an absolute path as an
   * `asyar-thumb://` URL (usable in extension view `<img>` tags and dynamic
   * command icons), or `null` when the platform has no icon source.
   * Requires the `files:read` permission and enforces the same declared-glob
   * scope, deny-list, and symlink checks as `read`, while permitting
   * directories and `.app` bundles. Rejects on scope denials or missing paths.
   */
  icon(path: string): Promise<string | null>;
  /**
   * Read-only, single-statement parameterized SQLite query under `files:read`.
   * SELECT-only authorizer, 2s timeout, 2,000-row cap; `BLOB`s return as base64.
   */
  query<T = Record<string, unknown>>(path: string, sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Register a remote or cloud file search provider matching a manifest contribution.
   * Returns a cleanup function that unregisters the provider.
   */
  registerFileSearchProvider(provider: FileSearchProviderRegistration): () => void;
}
