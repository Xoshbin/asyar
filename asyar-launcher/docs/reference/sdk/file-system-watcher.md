### 8.29 `FileSystemWatcherService` — Watch directories for changes

**Runs in:** view only as currently shipped. The fs-watch surface predates
the worker/view split — see [the deferred fs-watch design note](#status).
Until the worker-context redesign lands, watcher subscriptions registered
from the view will silently miss events while the panel is closed.

**Permission required:** `fs:watch`, plus a matching `permissionArgs["fs:watch"]` array of glob patterns in the manifest. The pattern list is the **scope** of what an extension is allowed to watch; calls to `watch(paths)` that escape every declared pattern are rejected at the host boundary with a permission error.

#### Status

This service is scheduled for redesign on top of the worker context.
New extensions should not depend on long-lived watch handles via this
proxy until the worker-aware redesign ships.

Use this to react to user-initiated changes on the filesystem that happen **outside** Asyar — Apple Shortcuts edits, SSH config tweaks, dotfile refreshes, Homebrew formula updates, and so on. The host exposes a tiny, stable shape (`{ type: 'change', paths: string[] }`) regardless of which OS-native backend produced the raw event (FSEvents on macOS, inotify on Linux, ReadDirectoryChangesW on Windows).

```typescript
interface FileSystemWatcherOptions {
  /** Default: true */
  recursive?: boolean;
  /** Default: 500. Clamped by the host to [50, 5000] ms. */
  debounceMs?: number;
}

interface FileSystemChangeEvent {
  type: 'change';
  /** Subset of the handle's watched roots that saw activity this tick.
   *  Roots-up coalesced — if 50 files under one root change, the root
   *  appears once. Extensions that don't care about specificity can
   *  ignore this and just re-fetch their source. */
  paths: string[];
}

interface WatcherHandle {
  onChange(cb: (e: FileSystemChangeEvent) => void): () => void;
  dispose(): Promise<void>;
}

interface IFileSystemWatcherService {
  watch(paths: string[], opts?: FileSystemWatcherOptions): Promise<WatcherHandle>;
}
```

**Manifest declaration:**

```json
{
  "permissions": ["fs:watch"],
  "permissionArgs": {
    "fs:watch": [
      "~/Library/Shortcuts/**",
      "~/.ssh/config"
    ]
  }
}
```

Each pattern must resolve **under `$HOME` or `/tmp`**. Patterns resolving outside (`/etc`, `/usr`, another user's home, etc.) are rejected at manifest load time. Glob syntax is [`globset`](https://docs.rs/globset/) — `*`, `**`, `?`, `[abc]`, `{a,b}` all work. Leading `~/` expands to the user's home directory at load time.

---

#### Example: Apple Shortcuts extension — reindex on change

```typescript
import type { IFileSystemWatcherService } from 'asyar-sdk';

const fsWatcher = context.getService<IFileSystemWatcherService>('fsWatcher');
const handle = await fsWatcher.watch(['~/Library/Shortcuts/']);

handle.onChange(async () => {
  // Don't trust deltas; just re-pull the source of truth.
  await reindexShortcuts();
});

// On extension teardown (unload, page close, etc.):
await handle.dispose();
```

#### Example: SSH config extension — watch a single file

```typescript
const fsWatcher = context.getService<IFileSystemWatcherService>('fsWatcher');
const handle = await fsWatcher.watch(['~/.ssh/config']);
handle.onChange((ev) => {
  console.log('SSH config changed:', ev.paths);
  reloadHosts();
});
```

#### Example: Dotfiles extension — multiple roots, one handle

```typescript
const handle = await fsWatcher.watch(
  ['~/.vimrc', '~/.zshrc', '~/.gitconfig'],
  { recursive: false, debounceMs: 250 },
);

handle.onChange(() => {
  markConfigsStale();
});
```

---

#### Subscription semantics

- **One handle = one watch scope.** Handles are immutable after `watch()`. To change the watched paths, dispose the existing handle and create a new one.
- **Multiple callbacks per handle.** Call `onChange` as many times as you like. Each returns its own unsubscribe function.
- **Ref-counted lifecycle.** Disposing a handle drops all its callbacks and frees the host-side debouncer. Disposing is idempotent — a second call is a silent no-op.
- **Auto-cleanup.** All handles for an extension are closed automatically on extension uninstall or disable. You don't need a teardown hook for the normal case.

#### Pattern validation at watch time

The host validates that every path passed to `watch()` is matched by at least one of the manifest's declared patterns. An extension with `permissionArgs["fs:watch"]: ["~/Library/Shortcuts/**"]` cannot `watch(['/etc/hosts'])` — the request is rejected with a permission error before any OS-level watcher is opened.

#### Resource limits

- Max 16 simultaneous handles per extension.
- Max 64 paths per handle.
- Max 512 paths across all extensions combined.

Breaches surface as a host-side validation error. These numbers are large enough that no well-behaved extension will hit them; they exist so a single buggy or malicious extension can't exhaust the host's kernel-level FS-watch budget (macOS FSEvents and Linux inotify both impose per-process ceilings).

#### Delivery caveats — read this before shipping

Push events are delivered to the extension's iframe via `postMessage`. If the iframe has been **idle for ≥7 minutes**, the host's iframe-lifecycle state machine may unmount it (the `Dormant` state — see [Tier 2 delivery mechanism](../architecture/tier2-command-delivery.md)). While the iframe is Dormant, filesystem changes still fire the Rust watcher, but the corresponding push events are dropped by the bridge with a debug log — the iframe is not there to receive them.

This is a pre-existing limitation shared across all Tier-2 push-event namespaces (`applicationIndex`, `appEvents`, `systemEvents`, `fsWatcher`); it is not specific to the file-system watcher.

**Practical guidance:** don't treat `onChange` as an authoritative changelog. When your extension mounts or when the next `onChange` arrives, re-fetch the source of truth rather than replaying only the deltas you observed. The Apple Shortcuts example above follows this pattern — the callback body does `await reindexShortcuts()`, not `applyPatch(ev)`.

#### Platform coverage

| Platform | Backend | Notes |
|---|---|---|
| macOS | FSEvents | Default. Canonicalizes through `/private/var/folders/...` for tempdirs. |
| Linux | inotify | Per-user inotify-instance and watch-count ceilings apply. |
| Windows | ReadDirectoryChangesW | Non-recursive mode only watches the root, not subdirs. |

The extension-facing event shape is identical across all three. OS-specific failure modes (e.g. Linux's `/proc/sys/fs/inotify/max_user_watches` limit) surface as a watch-time error from `watch()` — there's no silent dropped-subscriber mode.

#### Lifecycle

| Event | Effect on handles |
|---|---|
| `handle.dispose()` | Host closes the debouncer; callbacks stop firing immediately. |
| Extension uninstall | All handles closed. Callbacks cease. |
| Extension disable | All handles closed. Callbacks cease. On re-enable, the extension must call `watch()` again. |
| Iframe reload / hot-reload | Handles tied to the previous iframe are garbage-collected by the normal uninstall/disable cleanup; after reload the extension issues fresh `watch()` calls. |
| App restart | Handles do not persist. Extensions re-issue `watch()` on boot. |
