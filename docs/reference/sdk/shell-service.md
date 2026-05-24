### `ShellService` — Spawn OS processes and stream their output

**Runs in:** both worker and view. Long-running processes that should
survive the panel closing belong in the worker.

**Permission required:** `shell:spawn`.

Lets extensions run arbitrary command-line tools and receive their `stdout`/`stderr` output as a real-time stream. Covers the full range of power-user extensions: video converters, package managers, git wrappers, Docker managers, download tools, and anything else that wraps a CLI binary.

Before any binary can be executed, the user must explicitly grant trust for that specific binary. Asyar shows a one-time consent dialog showing the full resolved path of the executable. Once the user clicks **Allow Always**, the approval is stored in SQLite and never asked again. Users can review and revoke trust at any time from **Settings → Extensions → Terminal Trust Store**.

```typescript
interface SpawnParams {
  /** The program to run. Short names (e.g. `"ffmpeg"`) are resolved to absolute paths
   *  before execution. */
  program: string;
  /** Command-line arguments. Defaults to `[]`. */
  args?: string[];
}

interface ShellChunk {
  /** Which output pipe this chunk came from. */
  stream: 'stdout' | 'stderr';
  /** One line of output text (newline stripped). */
  data: string;
}

interface ShellHandle {
  /** Id of the underlying spawn. Stable across `attach()` — persist this in
   *  extension storage to reattach after an iframe reload. */
  readonly spawnId: string;
  /** Called for each line of output from the process. */
  onChunk(cb: (chunk: ShellChunk) => void): void;
  /** Called when the process exits successfully. `exitCode` may be `undefined`
   *  if the process was killed before it could report an exit code. */
  onDone(cb: (exitCode?: number) => void): void;
  /** Called if the process fails to start or the extension calls `abort()`. */
  onError(cb: (error: { code: string; message: string }) => void): void;
  /** Send SIGKILL (Unix) / TerminateProcess (Windows) to the running process. */
  abort(): void;
}

interface ShellDescriptor {
  /** The spawnId originally generated for this process. */
  spawnId: string;
  /** Absolute path that was spawned. */
  program: string;
  /** Arguments the process was launched with. */
  args: string[];
  /** OS-level process id. */
  pid: number;
  /** Unix millis — when the process was registered. */
  startedAt: number;
}

interface IShellService {
  /**
   * Spawn a process and stream its output.
   *
   * Returns a `ShellHandle` immediately. Register your callbacks before the
   * process has a chance to produce output — though in practice the process
   * cannot start until the current JavaScript turn completes.
   */
  spawn(params: SpawnParams): ShellHandle;

  /**
   * Snapshot of every live spawn the calling extension still owns. Intended
   * for iframe-reload recovery: on boot, query `list()`, then reattach to
   * any descriptors you recognise.
   */
  list(): Promise<ShellDescriptor[]>;

  /**
   * Re-subscribe to an existing spawn's stream using a spawnId returned by
   * `list()`. The returned handle behaves identically to one from `spawn()`.
   * If the process already exited within the registry's retention window
   * (~10 minutes), `onDone` fires immediately with the stored exit code.
   */
  attach(spawnId: string): ShellHandle;
}
```

**Minimal usage:**

```typescript
import type { IShellService } from 'asyar-sdk';

const shell = context.getService<IShellService>('shell');

const handle = shell.spawn({ program: 'git', args: ['status'] });

handle.onChunk(({ stream, data }) => console.log(`[${stream}] ${data}`));
handle.onDone((exitCode) => console.log('Exited:', exitCode));
handle.onError(({ message }) => console.warn('[Shell] spawn failed:', message));
```

**Typical pattern — ffmpeg converter with live progress toast:**

```typescript
import type { IShellService, IFeedbackService } from 'asyar-sdk';

const shell    = context.getService<IShellService>('shell');
const feedback = context.getService<IFeedbackService>('feedback');

async function convertVideo(inputPath: string, outputPath: string) {
  const toast = await feedback.showToast({
    title: 'Converting…',
    message: 'Starting ffmpeg',
    style: 'animated',
  });

  const handle = shell.spawn({
    program: 'ffmpeg',
    args: ['-i', inputPath, '-c:v', 'libx265', '-y', outputPath],
  });

  // ffmpeg writes progress to stderr
  handle.onChunk(({ stream, data }) => {
    if (stream === 'stderr' && data.startsWith('frame=')) {
      feedback.updateToast(toast.id, { message: data.trim() });
    }
  });

  handle.onDone((exitCode) => {
    if (exitCode === 0) {
      feedback.showHUD('Conversion complete');
    } else {
      feedback.updateToast(toast.id, {
        title: 'Conversion failed',
        message: `ffmpeg exited with code ${exitCode}`,
        style: 'failure',
      });
    }
  });

  handle.onError(({ code, message }) => {
    if (code === 'ABORTED') return; // user cancelled
    feedback.updateToast(toast.id, { title: 'Error', message, style: 'failure' });
  });

  // Optionally abort if the user navigates away
  context.onHide(() => handle.abort());
}
```

**Typical pattern — Docker container manager:**

```typescript
const handle = shell.spawn({
  program: 'docker',
  args: ['ps', '--format', '{{json .}}'],
});

const containers: DockerContainer[] = [];

handle.onChunk(({ data }) => {
  try {
    containers.push(JSON.parse(data));
  } catch { /* skip malformed lines */ }
});

handle.onDone(() => {
  // render containers list
  renderContainers(containers);
});
```

#### How it works under the hood

```
Extension iframe                         Host (Svelte + Rust)
─────────────────────────────────────────────────────────────────────────
1. SDK generates spawnId (crypto.randomUUID())
2. SDK registers window message listener for asyar:stream events
   keyed by spawnId  ← BEFORE broker.invoke(), no race condition
3. ShellServiceProxy calls:
   broker.invoke('shell:spawn', { program, args, spawnId })
   MessageBroker prepends 'asyar:api:' → wire type: 'asyar:api:shell:spawn'
                                          ─────────────────────────────►
                                          4. ExtensionIpcRouter:
                                             permission check (shell:spawn)
                                             inject extensionId
                                          5. ShellService.spawn():
                                             a. shell_resolve_path(program)
                                                → absolute path via `which`/`where`
                                             b. shellConsentService.requestConsent()
                                                → shell_check_trust (SQLite)
                                                → if not trusted: show consent dialog
                                                → if denied: throw PERMISSION_DENIED
                                                → if allowed: shell_grant_trust (SQLite)
                                             c. StreamDispatcher.create(spawnId)
                                             d. listen('asyar:shell:chunk', …)
                                                listen('asyar:shell:done', …)
                                                listen('asyar:shell:error', …)
                                             e. invoke('shell_spawn', { … }) [fire & forget]
                                             return { streaming: true }
                                          ◄─────────────────────────────
4. invoke() resolves { streaming: true }
   SDK returns ShellHandle to extension

                                          Rust (shell_spawn):
                                            permission check (defense-in-depth)
                                            trust check (defense-in-depth)
                                            tokio::process::Command::spawn()
                                            store PID in ShellProcessRegistry
                                            tokio task: tokio::join!(
                                              stdout reader → emit asyar:shell:chunk,
                                              stderr reader → emit asyar:shell:chunk,
                                              child.wait()
                                            )
                                            emit asyar:shell:done / asyar:shell:error

                                          TS ShellService (event listeners):
                                            → StreamDispatcher.sendChunk()
                                            → StreamDispatcher.sendDone()

StreamDispatcher → Extension iframe:
  { type: 'asyar:stream', streamId: spawnId, phase: 'chunk',
    data: { stream: 'stdout'|'stderr', data: '...' } }  × N

  { type: 'asyar:stream', streamId: spawnId, phase: 'done', data: { exitCode } }

5. onChunk / onDone / onError callbacks fire in extension
```

The host never awaits the process — `spawn()` returns `{ streaming: true }` immediately and output flows as a unidirectional message stream. This is the same `asyar:stream:*` protocol used by `AIService`.

#### Aborting a process

Calling `handle.abort()` sends SIGKILL on Unix or `TerminateProcess` on Windows. The process is killed immediately — no graceful shutdown. The `onError` callback fires with `{ code: 'ABORTED', message: 'Process was aborted by the extension' }`.

```typescript
const handle = shell.spawn({ program: 'yt-dlp', args: [url] });

// Kill it if the user closes the extension panel
context.onHide(() => handle.abort());
```

Calling `abort()` after the process has already exited is a no-op.

#### Surviving iframe reloads — `list()` and `attach()`

Extension iframes are reloaded on hot-reload in development and can be torn down and rebuilt by the launcher at any time. Child processes spawned through `ShellService` survive that reload in Rust — only the SDK-side message listener inside the iframe is lost.

On extension boot, call `list()` to discover every spawn the launcher still remembers for this extension, then call `attach(spawnId)` on each descriptor to rebuild a live `ShellHandle`.

```typescript
import type { IShellService } from 'asyar-sdk';

const shell = context.getService<IShellService>('shell');

// When the user starts a pomodoro, stash the spawnId so we can recover it.
function startPomodoro() {
  const handle = shell.spawn({ program: '/usr/local/bin/pomodoro-timer' });
  storage.set('pomodoro.spawnId', handle.spawnId);
  wireClock(handle);
}

async function reattachPomodoroTimer() {
  const alive = await shell.list();
  const saved = await storage.get<string>('pomodoro.spawnId');
  const descriptor = alive.find((d) => d.spawnId === saved);
  if (!descriptor) return; // nothing to resume

  const handle = shell.attach(descriptor.spawnId);
  wireClock(handle);
}

function wireClock(handle: ShellHandle) {
  handle.onChunk(({ data }) => updateClockUi(data));
  handle.onDone((code) => finishPomodoro(code));
  handle.onError(({ message }) => showError(message));
}

// Kick off reattach as soon as the extension boots.
reattachPomodoroTimer();
```

**Extension isolation guarantee.** `list()` only returns spawns owned by the calling extension; you never see another extension's child processes. `attach()` refuses cross-extension ids — the `onError` callback fires with `{ code: 'ATTACH_FAILED', … }` and no stream is opened.

**Retention window.** Finished entries remain reachable via `attach()` for ~10 minutes after exit, so a reload that happens right after a process completes still resolves with the stored `exitCode`. After the window, the registry GC drops the entry and `attach()` reports `ATTACH_FAILED`.

**Not replayed.** `attach()` delivers future chunks and — for already-finished processes — a single terminal `done` / `error`. It does not replay any output the process produced before attach. If you need the full history, buffer it yourself between the `spawn()` call and extension boot.

#### Error handling

| Scenario | Callback | `.code` |
|---|---|---|
| Binary not found (`which` returns nothing) | `onError` | `'NOT_FOUND'` |
| User denies the consent dialog | `onError` | `'PERMISSION_DENIED'` |
| `shell:spawn` not in manifest | IPC call rejects (Promise) | — |
| Process exits non-zero | `onDone` with non-zero `exitCode` | — |
| Process crashes / OS-level error | `onError` | `'SHELL_ERROR'` |
| Extension calls `abort()` | `onError` | `'ABORTED'` |

A non-zero exit code is delivered via `onDone`, not `onError` — the process completed from Asyar's perspective. Treat exit codes the same way a shell script would.

#### Trust and consent

The first time an extension calls `spawn()` for a given binary, the user sees a consent dialog:

```
YouTube Downloader wants to run a program:

  $ /opt/homebrew/bin/yt-dlp          ← full resolved path, always

  Alias: yt-dlp

  ⚠ This program is outside standard system locations.
    Only continue if you trust this extension and its publisher.

  [ Allow Always ]   [ Deny ]
```

Clicking **Allow Always** stores the trust permanently in `~/.local/share/asyar/asyar_data.db` (or the platform equivalent). The next call to `spawn()` with the same binary skips the dialog entirely.

Trust is scoped per extension: granting trust for `ffmpeg` to the YouTube Downloader extension does not grant `ffmpeg` access to any other extension.

#### Revoking trust

Users can revoke trust at any time:

**Settings → Extensions → Terminal Trust Store**

The list shows every extension that has declared `shell:spawn`, grouped with the binaries it has been granted access to, and when each was approved. Each binary has a **Revoke** button. After revocation, the next `spawn()` call for that binary triggers the consent dialog again.

#### Security model

- **Absolute path enforcement.** Short names (`ffmpeg`) are resolved to full absolute paths (`/opt/homebrew/bin/ffmpeg`) via `which`/`where` before consent is requested. The absolute path is what is stored in the trust table — PATH manipulation between approval and execution cannot redirect to a different binary.
- **Defense-in-depth trust check.** The Rust `shell_spawn` command re-checks the trust table independently of the TS consent layer. A compromised TS layer cannot bypass the gate.
- **Non-standard path warning.** The consent dialog flags binaries outside known safe locations (`/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `C:\Windows\System32`, etc.).
- **Extension isolation.** Trust records are keyed by `(extensionId, binaryPath)`. Extensions cannot read or benefit from trust granted to other extensions.
- **Uninstall cleanup.** When an extension is uninstalled, all its `shell_trusted_binaries` rows are deleted automatically.
- **Output-only.** Extensions receive stdout/stderr. They cannot write to stdin — interactive processes are not supported.

#### Cross-platform notes

`ShellService` works on macOS, Windows, and Linux. The binary resolution strategy differs:

| Platform | Resolution command | Binary name example |
|---|---|---|
| macOS / Linux | `which` | `ffmpeg` → `/opt/homebrew/bin/ffmpeg` |
| Windows | `where` | `ffmpeg` → `C:\tools\ffmpeg\bin\ffmpeg.exe` |

Extensions that wrap macOS-only tools (like `osascript` or `brew`) should declare `"platforms": ["mac"]` in their manifest to prevent install on unsupported platforms.

#### Privacy & security note for reviewers

`shell:spawn` grants an extension the ability to run arbitrary executables on the user's machine with the same permissions as the Asyar process. Reviewers will verify:

- Every binary the extension may spawn is documented in the extension description.
- `spawn()` is called only in response to an explicit user action, not silently on load.
- No extension uses `shell:spawn` to exfiltrate data (e.g., spawning `curl` to POST to a remote server in the background).

Extensions that use `shell:spawn` receive additional scrutiny during store review.

---
