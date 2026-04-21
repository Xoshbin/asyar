import { invoke } from '@tauri-apps/api/core';

/**
 * Host-side thin wrapper over the Rust `fs_watch_*` Tauri commands.
 *
 * The ExtensionIpcRouter flattens the SDK proxy's payload via
 * `Object.values(payload)`, so `{ paths, opts }` from the SDK arrives
 * here as positional `(paths, opts)`. The router also auto-injects the
 * caller's `extensionId` as the first argument; privileged host-context
 * calls pass `null`.
 *
 * The Rust `FsWatcherRegistry` owns all watcher state — this service is
 * pure IPC glue, no business logic.
 */
export interface IFsWatcherIpc {
  create(
    extensionId: string | null,
    paths: string[],
    opts?: { recursive?: boolean; debounceMs?: number } | null,
  ): Promise<string>;
  dispose(extensionId: string | null, handleId: string): Promise<void>;
}

export class FsWatcherService implements IFsWatcherIpc {
  async create(
    extensionId: string | null,
    paths: string[],
    opts?: { recursive?: boolean; debounceMs?: number } | null,
  ): Promise<string> {
    return invoke<string>('fs_watch_create', {
      extensionId,
      paths,
      opts: opts ?? null,
    });
  }

  async dispose(
    extensionId: string | null,
    handleId: string,
  ): Promise<void> {
    return invoke<void>('fs_watch_dispose', {
      extensionId,
      handleId,
    });
  }
}

export const fsWatcherService = new FsWatcherService();
