### 8.18 `ApplicationService` — Frontmost metadata + app-presence push events

**Permissions required:**
- `application:read` — for the query surface (`getFrontmostApplication`, `listApplications`, `syncApplicationIndex`, `isRunning`) **and** the `onApplicationsChanged` index-watch subscription (same data class — index events carry the same information `listApplications` returns)
- `app:frontmost-watch` — for the three app-presence `on*` push subscriptions (`onApplicationLaunched`, `onApplicationTerminated`, `onFrontmostApplicationChanged`)

`ApplicationService` combines three related surfaces:

1. **Query surface** (`application:*` IPC namespace) — one-shot request/response for frontmost metadata, the installed-app index, and a synchronous `isRunning` presence check.
2. **Presence push surface** (`appEvents:*` IPC namespace) — subscribe to launch / terminate / frontmost-changed events that Raycast's built-in Application API does not expose at all. Subscriptions are ref-counted on the SDK side: multiple listeners for the same kind share a single backend subscription; the last disposer fires an `appEvents:unsubscribe`.
3. **Index push surface** (`applicationIndex:*` IPC namespace) — subscribe to filesystem-driven changes to the installed-application index. Fires when an app is installed or removed from a watched default scan directory (e.g. `/Applications`) or when the user edits `settings.search.additionalScanPaths`. Same ref-counted shape as the presence surface.

```typescript
interface IApplicationService {
  // ── query surface (permission: application:read) ──
  getFrontmostApplication(): Promise<FrontmostApplication>;
  syncApplicationIndex(extraPaths?: string[]): Promise<{ added: number; removed: number; total: number }>;
  listApplications(extraPaths?: string[]): Promise<InstalledApplication[]>;
  isRunning(bundleId: string): Promise<boolean>;

  // ── presence push surface (permission: app:frontmost-watch) ──
  onApplicationLaunched(cb: (e: Extract<AppPresenceEvent, {type: 'launched'}>) => void): Disposer;
  onApplicationTerminated(cb: (e: Extract<AppPresenceEvent, {type: 'terminated'}>) => void): Disposer;
  onFrontmostApplicationChanged(cb: (e: Extract<AppPresenceEvent, {type: 'frontmost-changed'}>) => void): Disposer;

  // ── index push surface (permission: application:read) ──
  onApplicationsChanged(cb: (e: ApplicationIndexEvent) => void): Disposer;
}

type AppPresenceEvent =
  | { type: 'launched';          pid: number; bundleId?: string; name: string; path?: string }
  | { type: 'terminated';        pid: number; bundleId?: string; name: string }
  | { type: 'frontmost-changed'; pid: number; bundleId?: string; name: string };

type ApplicationIndexEvent = {
  type: 'applications-changed';
  added: number;    // apps newly added since last scan
  removed: number;  // apps removed since last scan
  total: number;    // current absolute count
};

type Disposer = () => void;

interface FrontmostApplication {
  name: string;
  bundleId?: string;
  path?: string;
  windowTitle?: string;
}
```

### Capability note — what Raycast doesn't have

Raycast's `getFrontmostApplication` is strictly pull-based; there is no way to subscribe to launch, terminate, or frontmost-changed events without polling. Asyar exposes those three events through `ApplicationService.on*`. Extensions that want to react *when* the user switches apps (rather than asking Asyar every second) should use the push surface; those that just need the current state can keep using `getFrontmostApplication()` or `isRunning()`.

### Usage — query surface

```typescript
const app = context.services.application;

const frontmost = await app.getFrontmostApplication();
console.log(frontmost.name, frontmost.bundleId, frontmost.windowTitle);

if (await app.isRunning('com.apple.Safari')) {
  console.log('Safari is running');
}
```

### Usage — push surface

```typescript
const app = context.services.application;

const dispose = app.onFrontmostApplicationChanged((e) => {
  console.log(`Now frontmost: ${e.name} (${e.bundleId ?? 'no bundle id'})`);
});

// Later, when the extension unloads:
dispose();
```

Disposers are idempotent — calling twice is a safe no-op. Subscriptions are also automatically released by the host when the extension uninstalls.

### Usage — index push surface

```typescript
const app = context.services.application;

// React every time an app is installed, uninstalled, or the user edits
// a directory in settings.search.additionalScanPaths. The host debounces
// filesystem events (default 500ms) and suppresses no-op rescans, so
// every callback invocation represents a real change.
const dispose = app.onApplicationsChanged((e) => {
  console.log(`index changed: +${e.added} / -${e.removed} (total ${e.total})`);
  // Typical reaction: refresh any UI that depends on the installed-app list,
  // e.g. call `app.listApplications()` again to get the fresh set.
});

// Later, when the extension unloads:
dispose();
```

### When to use `onApplicationsChanged` vs. periodic `listApplications`

Use the subscription when your extension's UI mirrors the installed-app set and needs to stay accurate without user action — for example, a launcher list, an "installed apps" picker, or an integration that indexes new apps. Keep a one-shot `listApplications()` call if you only need the list once at extension startup and a stale view is acceptable.

The event is driven by a `notify` filesystem watcher that arms on `/Applications`, `/System/Applications`, and each path in `settings.search.additionalScanPaths`. Paths added to settings arm the watcher within a few hundred milliseconds; paths removed from settings are unwatched immediately. The watcher is **not** a general-purpose filesystem subscription — it only tracks changes that affect the application index.

### Platform coverage matrix

| Event                   | macOS                                                | Windows                                                                | Linux (X11)                                               | Linux (Wayland) |
|------------------------ |------------------------------------------------------|------------------------------------------------------------------------|-----------------------------------------------------------|-----------------|
| `launched`              | `NSWorkspaceDidLaunchApplicationNotification`        | WMI `__InstanceCreationEvent` on `Win32_Process`                       | `/proc` 1s poll + DBus `NameOwnerChanged` (GUI heuristic) | same as X11     |
| `terminated`            | `NSWorkspaceDidTerminateApplicationNotification`     | WMI `__InstanceDeletionEvent` on `Win32_Process`                       | `/proc` 1s poll + DBus `NameOwnerChanged`                 | same as X11     |
| `frontmost-changed`     | `NSWorkspaceDidActivateApplicationNotification`      | `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` on a message-pump thread    | `_NET_ACTIVE_WINDOW` property changes via `x11rb`         | **not emitted** — no Wayland equivalent; one warning logged at startup |

#### Linux limitations

The procfs poller sees *every* process transition, not just GUI apps — the Linux `launched`/`terminated` stream is therefore noisier than macOS/Windows. The DBus `NameOwnerChanged` path augments it with explicit GUI-app registrations (e.g. `com.spotify.Client`, `com.slack.Slack`) filtered by the `dbus_name_looks_like_gui_app` heuristic.

On Wayland there is no portable equivalent of `_NET_ACTIVE_WINDOW`, so `onFrontmostApplicationChanged` never fires. The watcher logs a single warning at startup and continues — the other two events still work.

### isRunning semantics per platform

| Platform | Interpretation of `bundleId` argument                                          |
|----------|--------------------------------------------------------------------------------|
| macOS    | Real bundle identifier; matched via `NSWorkspace.runningApplications`          |
| Windows  | Process name (with or without `.exe`); scanned via `CreateToolhelp32Snapshot`  |
| Linux    | `/proc/<pid>/status` `Name` or a DBus well-known name (falls back to `NameHasOwner`) |

### Platform notes — query surface

#### macOS Accessibility permissions

Retrieving the **window title** via `getFrontmostApplication` on macOS requires **Accessibility Permissions**. If Asyar lacks them, `windowTitle` is returned as an empty string. On the first call Asyar checks and will guide the user to **System Settings > Privacy & Security > Accessibility** if needed.

#### Windows

On Windows, `bundleId` in `FrontmostApplication` returns the executable name (e.g. `chrome.exe`). The `name` field returns the localized description from file version info where available, otherwise the file name.

---
