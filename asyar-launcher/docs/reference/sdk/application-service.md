### 8.18 `ApplicationService` — Frontmost metadata + app-presence push events

**Permissions required:**
- `application:read` — for the query surface (`getFrontmostApplication`, `listApplications`, `syncApplicationIndex`, `isRunning`)
- `app:frontmost-watch` — for the three `on*` push subscriptions below

`ApplicationService` combines two related but distinct surfaces:

1. **Query surface** (`application:*` IPC namespace) — one-shot request/response for frontmost metadata, the installed-app index, and a synchronous `isRunning` presence check.
2. **Push surface** (`appEvents:*` IPC namespace) — subscribe to launch / terminate / frontmost-changed events that Raycast's built-in Application API does not expose at all. Subscriptions are ref-counted on the SDK side: multiple listeners for the same kind share a single backend subscription; the last disposer fires an `appEvents:unsubscribe`.

```typescript
interface IApplicationService {
  // ── query surface (permission: application:read) ──
  getFrontmostApplication(): Promise<FrontmostApplication>;
  syncApplicationIndex(extraPaths?: string[]): Promise<{ added: number; removed: number; total: number }>;
  listApplications(extraPaths?: string[]): Promise<InstalledApplication[]>;
  isRunning(bundleId: string): Promise<boolean>;

  // ── push surface (permission: app:frontmost-watch) ──
  onApplicationLaunched(cb: (e: Extract<AppPresenceEvent, {type: 'launched'}>) => void): Disposer;
  onApplicationTerminated(cb: (e: Extract<AppPresenceEvent, {type: 'terminated'}>) => void): Disposer;
  onFrontmostApplicationChanged(cb: (e: Extract<AppPresenceEvent, {type: 'frontmost-changed'}>) => void): Disposer;
}

type AppPresenceEvent =
  | { type: 'launched';          pid: number; bundleId?: string; name: string; path?: string }
  | { type: 'terminated';        pid: number; bundleId?: string; name: string }
  | { type: 'frontmost-changed'; pid: number; bundleId?: string; name: string };

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
