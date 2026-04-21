import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * Options for `FileSystemWatcherService.watch`.
 */
export interface FileSystemWatcherOptions {
  /** Default: true. Pass `false` to watch only immediate children of each root. */
  recursive?: boolean;
  /** Default: 500ms. Clamped by the host to [50, 5000]. Smaller windows
   *  trade CPU for fresher events; larger windows coalesce more aggressively. */
  debounceMs?: number;
}

/**
 * Coalesced filesystem change event. The `paths` field carries the subset
 * of **the handle's own watched roots** whose subtrees saw activity this
 * tick — not the list of individual files that changed. Roots-up
 * coalescing hides cross-platform event-fidelity differences
 * (FSEvents / inotify / ReadDirectoryChangesW).
 */
export interface FileSystemChangeEvent {
  type: 'change';
  paths: string[];
}

/**
 * Handle returned by `watch()`. Register callbacks with `onChange` and
 * release the handle with `dispose`. Dispose is idempotent.
 */
export interface WatcherHandle {
  /** Register a callback. Returns an unsubscribe function. Multiple
   *  callbacks on one handle are all fired (in registration order) for
   *  each event. */
  onChange(cb: (e: FileSystemChangeEvent) => void): () => void;
  /** Stop watching on the host side. After resolve, no further `onChange`
   *  callbacks fire even for late-arriving events. Second and subsequent
   *  calls are no-ops. */
  dispose(): Promise<void>;
}

/**
 * SDK surface for the filesystem-watch capability. Requires `fs:watch`
 * in the extension's manifest permissions AND a matching
 * `permissionArgs["fs:watch"]` array of glob patterns covering the paths
 * passed to `watch()`. Example manifest:
 *
 * ```json
 * {
 *   "permissions": ["fs:watch"],
 *   "permissionArgs": {
 *     "fs:watch": ["~/Library/Shortcuts/**"]
 *   }
 * }
 * ```
 */
export interface IFileSystemWatcherService {
  /** Watch one or more paths. Every path must be matched by a glob in
   *  `permissionArgs["fs:watch"]`; otherwise rejects with a permission
   *  error. Auto-disposed on extension uninstall or disable. */
  watch(
    paths: string[],
    opts?: FileSystemWatcherOptions,
  ): Promise<WatcherHandle>;
}

interface WireCreateResponse {
  handleId: string;
}

interface WirePushPayload {
  handleId: string;
  change: FileSystemChangeEvent;
}

/**
 * Implementation of `IFileSystemWatcherService`. One instance per
 * `ExtensionContext`. Maintains a handleId → callback-set map and a
 * single broker-level push listener (installed lazily on first `watch`).
 */
export class FileSystemWatcherServiceProxy
  extends BaseServiceProxy
  implements IFileSystemWatcherService
{
  private callbacks = new Map<string, Set<(e: FileSystemChangeEvent) => void>>();
  private pushListenerInstalled = false;

  async watch(
    paths: string[],
    opts?: FileSystemWatcherOptions,
  ): Promise<WatcherHandle> {
    this.ensurePushListener();
    const { handleId } = await this.broker.invoke<WireCreateResponse>(
      'fsWatcher:create',
      { paths, opts: opts ?? {} },
    );
    if (!this.callbacks.has(handleId)) {
      this.callbacks.set(handleId, new Set());
    }
    return this.buildHandle(handleId);
  }

  private ensurePushListener(): void {
    if (this.pushListenerInstalled) return;
    this.pushListenerInstalled = true;
    this.broker.on('asyar:event:fs-watch:push', (payload: unknown) => {
      const p = payload as WirePushPayload | undefined;
      if (!p || typeof p.handleId !== 'string' || !p.change) return;
      const cbs = this.callbacks.get(p.handleId);
      if (!cbs) return;
      for (const cb of cbs) {
        try {
          cb(p.change);
        } catch {
          // One bad callback must not break the rest.
        }
      }
    });
  }

  private buildHandle(handleId: string): WatcherHandle {
    let disposed = false;
    return {
      onChange: (cb) => {
        if (disposed) return () => undefined;
        const cbs = this.callbacks.get(handleId);
        cbs?.add(cb);
        return () => {
          cbs?.delete(cb);
        };
      },
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        // Drop local callbacks first so any late push events that arrive
        // between now and the host-side dispose don't fire.
        this.callbacks.delete(handleId);
        try {
          await this.broker.invoke<void>('fsWatcher:dispose', { handleId });
        } catch {
          // Host-side sweep (uninstall/disable) is authoritative; a failed
          // explicit dispose is non-fatal from the extension's POV.
        }
      },
    };
  }
}
