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

/**
 * Generic file-search capability, exposed to Tier 2 extensions through the
 * same `files:*` wire namespace the Tier 1 "Search Files" view itself
 * consumes host-side. Requires `files:search`.
 */
export interface IFilesService {
  /** Bounded per-keystroke query against the local file index. */
  search(query: string, opts?: FileSearchOptions): Promise<FileHit[]>;
  /** Current index lifecycle state — useful for showing a "still indexing" hint. */
  status(): Promise<IndexStatus>;
}
