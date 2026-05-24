### 8.25 `PowerService` — Prevent the OS from sleeping

**Runs in:** both worker and view. Inhibitors that need to outlive the
view should be acquired from the worker.

**Permission required:** `power:inhibit` for all three methods.

Request an OS-level sleep inhibitor so long-running extension work (a transcription job, a bulk upload, a periodic sync) doesn't get interrupted by the machine going to sleep. Replaces the "shell out to `caffeinate`" pattern with a first-class cross-platform service that integrates with the OS's real power-management API.

```typescript
interface KeepAwakeOptions {
  system?: boolean;   // prevent system idle sleep (default: true)
  display?: boolean;  // keep the display on (default: false)
  disk?: boolean;     // prevent disk idle (default: false)
  reason: string;     // human-readable; surfaced in OS power panels where supported
}

interface ActiveInhibitor {
  token: string;
  options: { system: boolean; display: boolean; disk: boolean };
  reason: string;
  createdAt: number;  // unix seconds
}

interface IPowerService {
  keepAwake(options: KeepAwakeOptions): Promise<string>; // returns token
  release(token: string): Promise<void>;
  list(): Promise<ActiveInhibitor[]>;
}
```

**Manifest declaration:**

```json
{ "permissions": ["power:inhibit"] }
```

**Usage — keep the machine awake during a long job:**

```typescript
const power = context.getService<IPowerService>('power');

async function transcribe(audioPath: string) {
  const token = await power.keepAwake({
    system: true,
    display: false,
    reason: 'Transcribing audio',
  });
  try {
    await runWhisper(audioPath);
  } finally {
    await power.release(token);
  }
}
```

**Usage — multiple inhibitors at once:**

```typescript
const upload = await power.keepAwake({ reason: 'Uploading backups' });
const download = await power.keepAwake({ reason: 'Syncing mailbox' });
// ... work in parallel ...
await Promise.all([power.release(upload), power.release(download)]);
```

**Rediscover inhibitors after iframe reload:**

The registry lives in the Rust host process, so tokens survive your iframe being reloaded or the extension's JS context being re-instantiated. Always call `list()` on startup to rediscover tokens you held before the reattach.

```typescript
onActivate(async (context) => {
  const power = context.getService<IPowerService>('power');
  const active = await power.list();
  if (active.length > 0) {
    logger.info(`Reattached with ${active.length} active inhibitor(s) — releasing`);
    await Promise.all(active.map((i) => power.release(i.token)));
  }
});
```

**How it works under the hood:**

| Platform | API                                   | How options map                                                                  |
|---------|----------------------------------------|----------------------------------------------------------------------------------|
| macOS   | `IOPMAssertionCreateWithName` (IOKit)  | `system` → `NoIdleSleepAssertion`, `display` → `PreventUserIdleDisplaySleep`, `disk` → `PreventDiskIdle`. One IOKit assertion per requested axis. |
| Linux   | `org.freedesktop.login1.Manager.Inhibit` (logind DBus) | Composed `what=` string (`idle:sleep`, plus `handle-lid-switch` for `display`); the returned fd is held by the Rust registry until release. |
| Windows | `SetThreadExecutionState`              | `ES_CONTINUOUS \| ES_SYSTEM_REQUIRED [\| ES_DISPLAY_REQUIRED]`. Each inhibitor is held on a dedicated worker thread since the flag is thread-sticky. |

**Non-systemd Linux:** Systems without logind (or where the DBus call fails for any reason) cause `keepAwake()` to reject with a `PowerUnavailable:` error. Asyar does NOT fall back to `systemd-inhibit` or shell tools — catch the error and degrade your feature's UX gracefully.

**Lifecycle:**

| Event                  | What happens to your tokens                             |
|------------------------|---------------------------------------------------------|
| Extension uninstall    | All tokens for this extension are released automatically. |
| Extension disable      | All tokens for this extension are released automatically via the uninstall cleanup path. |
| Iframe reload          | Tokens survive — call `list()` to rediscover.           |
| Launcher process exit  | OS reclaims all handles.                                |

> **Pro Tip:** The token returned by `keepAwake()` is an opaque UUID — don't parse or store assumptions about its format. Always round-trip it through `release()` or `list()`.

---
