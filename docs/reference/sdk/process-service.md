### 8.33 `ProcessService` — List and kill running processes

**Runs in:** both worker and view.

**Permission required:** `process:read` for `list()`, `process:kill` for `kill()`. Declare only what you use — read-only monitors should not ask for `process:kill`.

List the machine's running processes — grouped per application, with live CPU and memory usage — and terminate them. This is the first-class, cross-platform replacement for shelling out to `ps` / `tasklist` / `kill`. The host enumerates processes with `sysinfo` on a background thread and re-derives a `protected` flag for OS-critical processes so an extension can't silently kill the kernel, `launchd`, `lsass.exe`, or `systemd`.

```typescript
type ProcessSortBy = 'cpu' | 'memory' | 'name';

interface ProcessInfo {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryBytes: number;
  path: string;
  owner: string;
  protected: boolean;   // OS-critical — kill refused unless confirmedProtected
}

interface AppGroup {
  appName: string;
  icon?: string | null;
  owner: string;
  totalCpu: number;
  totalMemoryBytes: number;
  processCount: number;
  protected: boolean;   // true if ANY child is protected
  children: ProcessInfo[];
}

interface KillFailure {
  pid: number;
  error: string;
}

interface KillResult {
  killed: number[];      // pids the OS confirmed terminated
  failed: KillFailure[]; // pids refused or that errored, each with a reason
}

interface ListProcessesOptions {
  query?: string;        // case-insensitive filter on app / process name
  sortBy: ProcessSortBy; // required
}

interface KillProcessesOptions {
  pids: number[];               // app-group kill = pass all child pids
  force: boolean;               // true → SIGKILL / hard TerminateProcess; false → graceful (SIGTERM)
  confirmedProtected?: boolean; // must be true to kill a process the host flagged `protected`
}

interface IProcessService {
  list(options: ListProcessesOptions): Promise<AppGroup[]>;
  kill(options: KillProcessesOptions): Promise<KillResult>;
}
```

**Manifest declaration:**

```json
{ "permissions": ["process:read", "process:kill"] }
```

**Usage — list the top CPU consumers:**

```typescript
const proc = context.getService<IProcessService>('process');

const groups = await proc.list({ sortBy: 'cpu' });
for (const app of groups) {
  console.log(`${app.appName}  ${app.totalCpu.toFixed(1)}%  ${app.processCount} processes`);
}
```

**Usage — search for an app:**

```typescript
const matches = await proc.list({ query: 'chrome', sortBy: 'memory' });
```

**Usage — kill an entire app group gracefully:**

```typescript
const app = matches[0];
const result = await proc.kill({
  pids: app.children.map((c) => c.pid), // a group kill is just all its child pids
  force: false,                          // SIGTERM first; let the app clean up
});

if (result.failed.length > 0) {
  for (const f of result.failed) console.warn(`pid ${f.pid}: ${f.error}`);
}
```

**Killing a protected process:**

The host re-derives the `protected` flag from a **fresh** snapshot on every `kill()` — it never trusts a flag the extension sends. A protected target is refused **before any OS signal is sent** unless you pass `confirmedProtected: true`:

```typescript
// Without confirmation, the protected pid lands in `failed`, not `killed`:
//   { pid: 1, error: "refused: protected process requires explicit confirmation" }
await proc.kill({ pids: [criticalPid], force: true });

// Opt in explicitly — only after a user confirmation dialog:
await proc.kill({ pids: [criticalPid], force: true, confirmedProtected: true });
```

> Treat `confirmedProtected` as a "the user explicitly clicked through a danger dialog" flag, never a default. Killing a protected process can crash the user's session.

**Partial results are normal.** `kill()` always resolves (it does not reject on a single failure). Each pid either lands in `killed` or in `failed` with a per-pid reason — a pid that has already exited, a permission error, or a refused protected kill. Always inspect both arrays.

**How `list()` works under the hood:**

| Platform | Enumeration | Grouping |
|---------|-------------|----------|
| macOS / Linux / Windows | `sysinfo` full process scan with a short CPU-delta sample, run on a blocking thread pool so the UI never freezes. | Processes are coalesced into `AppGroup`s by application; group totals sum each child's CPU and memory. |

**How the `protected` classifier works** (`process_manager::protected`):

| Platform | What's flagged protected |
|---------|--------------------------|
| macOS   | Core names (`kernel_task`, `launchd`, `WindowServer`, `loginwindow`, `Dock`, `Finder`) **or** root-owned binaries under `/System/`, `/usr/libexec/`, `/sbin/`, `/usr/sbin/`. |
| Windows | Core names (`System`, `smss.exe`, `csrss.exe`, `wininit.exe`, `services.exe`, `lsass.exe`, `winlogon.exe`) **or** `SYSTEM`-owned binaries under `\Windows\System32`. |
| Linux   | pid 1 (init / systemd), kernel threads (pid 2 `kthreadd` or its children), **or** root-owned binaries under `/sbin/` and `/usr/sbin/`. |

**Permission gate:** `process:read` and `process:kill` are enforced in the Rust host (`commands/process.rs` → `ExtensionPermissionRegistry`), not in JS. An extension with `process:read` but not `process:kill` can list but every `kill()` is rejected at the host.

---
