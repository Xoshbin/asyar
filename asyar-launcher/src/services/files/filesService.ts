import {
  fileSearch,
  fileIndexStatus,
  filesReadText,
  filesReadRange,
  filesGlob,
  filesGlobEntries,
  filesThumbnail,
} from '../../lib/ipc/fileSearchCommands';
import type {
  FileHit,
  FileSearchOptions,
  IndexStatus,
  FileReadRangeOptions,
  FileChunk,
  FileGlobOptions,
  FileGlobEntry,
  FileGlobEntriesOptions,
} from 'asyar-sdk/contracts';

const DISABLED_STATUS: IndexStatus = {
  state: 'disabled',
  entryCount: 0,
  lastScanMs: 0,
  snapshotLoaded: false,
  capReached: false,
};

/**
 * The `files` namespace is in ALWAYS_INJECTS_CALLER_ID, so every method
 * receives the router-verified caller identity first — `null` for
 * privileged host-context calls. `search`/`status` don't use it (the index
 * is one shared, read-only surface); `read` forwards it to the Rust
 * command, where a non-null caller is scoped to its declared
 * `permissionArgs["files:read"]` globs.
 */
export class FilesService {
  async search(
    callerExtensionId: string | null,
    query: string,
    opts?: FileSearchOptions,
  ): Promise<FileHit[]> {
    void callerExtensionId;
    const response = await fileSearch(query, opts?.typeFilter, opts?.limit);
    return response.hits;
  }

  async status(callerExtensionId: string | null): Promise<IndexStatus> {
    void callerExtensionId;
    try {
      return await fileIndexStatus();
    } catch {
      return DISABLED_STATUS;
    }
  }

  async read(
    callerExtensionId: string | null,
    path: string,
    opts?: { maxBytes?: number } | null,
  ): Promise<string> {
    return filesReadText(callerExtensionId, path, opts?.maxBytes);
  }

  async glob(
    callerExtensionId: string | null,
    pattern: string,
    opts?: FileGlobOptions | null,
  ): Promise<string[]> {
    return filesGlob(callerExtensionId, pattern, opts?.maxResults ?? undefined);
  }

  async globEntries(
    callerExtensionId: string | null,
    pattern: string,
    opts?: FileGlobEntriesOptions | null,
  ): Promise<FileGlobEntry[]> {
    return filesGlobEntries(callerExtensionId, pattern, opts);
  }

  async readRange(
    callerExtensionId: string | null,
    path: string,
    opts?: FileReadRangeOptions | null,
  ): Promise<FileChunk> {
    return filesReadRange(callerExtensionId, path, opts);
  }

  async thumbnail(
    callerExtensionId: string | null,
    path: string,
    opts?: { maxDim?: number } | null,
  ): Promise<string | null> {
    return filesThumbnail(callerExtensionId, path, opts?.maxDim);
  }
}

export const filesService = new FilesService();
