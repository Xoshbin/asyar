# Kill Process — Design

**Date:** 2026-06-20
**Status:** Approved design, pending implementation plan
**Extension id:** `org.asyar.kill-process`

## Summary

A cross-platform "Kill Process" feature for Asyar, inspired by the Raycast
[kill-process](https://www.raycast.com/rolandleth/kill-process) extension but
better: grouped-by-app presentation, live CPU/memory sorting, and smart
guardrails that protect OS-critical processes.

It ships as a **first-party Tier 2 extension** (sandboxed iframes) that consumes
a **new generic `process` platform service** in the host. Killing OS processes
is privileged and cannot run inside a sandboxed iframe, so the capability lives
in Rust and is exposed to the extension over permission-gated IPC. The `process`
namespace is generic — any future extension (system monitor, "restart app") can
reuse it.

## Goals

- Dedicated view (Activity-Monitor-style) listing running processes, grouped by
  application, sorted by CPU or memory.
- Graceful **Kill** and **Force Kill** actions.
- **Smart guardrails:** OS-critical / kernel / core-system processes are flagged
  `protected` and require a distinct, non-skippable confirmation.
- Raycast-familiar naming and preferences to ease migration.
- Cross-platform: macOS, Windows, Linux.

## Non-goals

- No root-search contribution (the feature is view-only).
- No background/worker activity (the extension's worker iframe is minimal).
- No "v1 minimal / v2 later" staging — this is the complete design.

## Architecture

```
extensions/kill-process  (Tier 2, sandboxed iframes)
  view: "Kill Process" — live list, sort, kill actions
  worker: minimal (no background work)
        │
        │  asyar:api:process:list / :kill   (postMessage IPC)
        │  gated by  process:read / process:kill  permissions
        ▼
SDK  ProcessServiceProxy  (view entry bag)
        │
        ▼
Host  ExtensionIpcRouter → processService (module singleton)
      + permission gate: Rust permissions.rs (real) + JS PERMISSION_MAP (mirror)
        │
        ▼
Rust  commands (thin) → process_manager service
      sysinfo: enumerate · group-by-app · sort · classify-protected · kill
```

All ranking, grouping, and filtering live in Rust (rust-first). The extension is
a pure presenter: it forwards `query` + `sortBy` and renders the result.

### Architectural Impact

- **Extension Host alignment:** the extension stays sandboxed; privilege lives in
  the host `process` service, reached only via permission-gated IPC. Mirrors the
  SearchOrchestrator consumer pattern.
- **Modular reusability:** `process` is a generic namespace, not a one-off for
  this extension.
- **Layer boundaries:** enumeration/grouping/sorting/classification/kill in Rust;
  Tauri commands are thin wrappers; the extension TS/Svelte is display-only.
- **Contribution model:** new `process` namespace in `NAMESPACES`; new
  `process:read` / `process:kill` permissions enforced in the Rust gate and
  declared in the extension manifest.
- **Backward-compat hacks:** none.

## IPC contract — `process` namespace

Added to `asyar-sdk/src/ipc/namespaces.ts` (`NAMESPACES`). Enforced in the Rust
gate `permissions.rs::get_required_permission` (the real gate) and mirrored in
the JS `PERMISSION_MAP` for completeness.

| Full type | Permission |
|---|---|
| `asyar:api:process:list` | `process:read` |
| `asyar:api:process:kill` | `process:kill` |

Proxy calls use the `{service}:{action}` form (`process:list`, `process:kill`);
`MessageBroker` prepends `asyar:api:`. The proxy lives in the **view** entry bag
(`asyar-sdk/src/ExtensionContext.ts`), not the worker — the feature is
view-driven.

### `process:list(params) -> AppGroup[]`

```
params: { query?: string, sortBy: 'cpu' | 'memory' | 'name' }

AppGroup {
  appName: string
  icon?: string
  owner: string
  totalCpu: number          // percent
  totalMemoryBytes: number
  processCount: number
  protected: boolean        // group is OS-critical
  children: ProcessInfo[]
}

ProcessInfo {
  pid: number
  name: string
  cpuPercent: number
  memoryBytes: number
  path: string
  owner: string
  protected: boolean
}
```

Rust performs filtering, grouping, and sorting. Returns serde camelCase JSON.

### `process:kill(params) -> KillResult`

```
params: { pids: number[], force: boolean, confirmedProtected?: boolean }
        // app-group kill = all child pids; force=true → SIGKILL

KillResult { killed: number[], failed: { pid: number, error: string }[] }
```

Rust **hard-refuses** any `protected` pid unless `confirmedProtected: true`. The
guardrail cannot be bypassed by a buggy/malicious caller — only by the explicit
user confirmation the view sends. All payloads are clean serializable types (no
callbacks, no proxies, no class instances across the boundary).

## Rust `process_manager` service

New module `src-tauri/src/process_manager/`, with thin Tauri command wrappers
delegating to it. Adds the `sysinfo` crate (cross-platform pid, name, cpu%,
memory, exe path, owner/uid, parent pid).

```
process_manager/
  mod.rs        list(query, sort) -> Vec<AppGroup>
                kill(pids, force, confirmed) -> KillResult
  grouping.rs   raw processes → AppGroup
  protected.rs  cross-platform OS-critical classifier
  types.rs      AppGroup, ProcessInfo, KillResult (serde, camelCase)
```

### Enumerate → group → sort → filter (all Rust)

- One `sysinfo::System`, refreshed per `list` call (yields live CPU%).
- **Group by app:**
  - macOS — the `.app` bundle in the exe path (collapses Chrome's ~30 helpers
    into one "Google Chrome" row).
  - Windows / Linux — group by executable name, falling back to the parent
    chain. Single-process apps remain single rows.
- **Sort** by `cpu` / `memory` / `name`.
- **Filter** by fuzzy match on app name; also match pid/path when the query looks
  numeric or path-like.

### Protected classifier (`protected.rs`)

Allow/deny heuristic per OS:

- **macOS:** root-owned under `/System`, `/usr/libexec`, `/sbin`; `kernel_task`,
  `launchd`, `WindowServer`, `loginwindow`, `Dock`, `Finder`.
- **Windows:** `System`, `smss.exe`, `csrss.exe`, `wininit.exe`, `services.exe`,
  `lsass.exe`, `winlogon.exe`; SYSTEM-owned; session 0.
- **Linux:** pid 1 (init/systemd); kernel threads (ppid == 2); root-owned
  `/usr/sbin` daemons.

### Kill semantics

- `force=false` → graceful: `kill_with(Signal::Term)` on Unix / `TerminateProcess`
  on Windows.
- `force=true` → SIGKILL.
- Refuses `protected` pids unless `confirmed`.
- Returns per-pid success/failure. Some kills require elevated rights; failures
  are reported honestly, never silently swallowed.

**Honest cross-platform note:** Windows has no SIGTERM, so "Kill" and "Force Kill"
converge there. The UI surfaces this rather than faking a distinction.

## Extension UX — `extensions/kill-process`

### Manifest

- id `org.asyar.kill-process`, `searchable: false`.
- `permissions: ["process:read", "process:kill"]`.
- One command:

```
command  id: "kill-process"   name: "Kill Process"   mode: "view"
         description: "Lists running processes by CPU or memory usage and (force) kills one"
```

### View

Activity-Monitor-style live list, keyboard-first:

```
 ┌─────────────────────────────────────────────────────────┐
 │  🔎 chrome                                    Sort: CPU ▾ │
 ├─────────────────────────────────────────────────────────┤
 │ ▸ 🌐 Google Chrome        58.2%   2.4 GB   30 procs      │
 │   🎬 zoom.us              22.1%   1.1 GB    8 procs      │
 │ ⚠ ⚙  WindowServer         14.0%   820 MB   protected    │
 │   🎵 Spotify               3.4%   410 MB    5 procs      │
 ├─────────────────────────────────────────────────────────┤
 │ ⏎ Kill    ⌘⏎ Force Kill    → Expand    ⌃R Refresh        │
 └─────────────────────────────────────────────────────────┘
```

- Rows are `AppGroup`s. `→` expands to child `ProcessInfo` rows (kill an
  individual helper). Protected rows show ⚠ and a muted/warning tint.
- Data arrives pre-grouped/sorted/filtered from Rust. Typing forwards the query
  to `process:list`; sort changes re-query; auto-refresh re-queries on the pref
  interval.
- **Actions live in the action panel; key hints live in the bottom bar** (Asyar's
  keyboard-first convention) — not as in-view buttons. Single Esc/Backspace pops
  the view (existing single-press contract).

### Actions

Kill (⏎), Force Kill (⌘⏎), Toggle sort, Refresh now, Show in Finder/Explorer
(when a path exists).

### Confirmation flow

- Normal app → quick confirm, skippable via the `skipConfirmation` pref.
- **Protected** → a distinct, harder warning that *ignores* `skipConfirmation`;
  only on explicit confirm does the view send `confirmedProtected: true`.

### Preferences (Raycast parity)

Mapped to Asyar `PreferenceType` enum values (`"textfield"` / `"number"` /
`"checkbox"` / `"dropdown"` — never `"text"`):

| Pref | Type | Default |
|---|---|---|
| `sortBy` | dropdown (CPU / Memory / Name) | CPU |
| `autoRefreshMs` | number | 3000 |
| `showPid` | checkbox | false |
| `showPath` | checkbox | false |
| `skipConfirmation` | checkbox | false |
| `closeAfterKill` | checkbox | true |

## Testing (TDD — RED first)

### Rust (`cargo test`, `cargo clippy --all-targets`)

- `protected.rs` — classifier unit tests over injected `ProcessInfo` fixtures
  (root-owned `/System` → protected; normal user app → not). Pure functions, no
  live system needed; same tests run on every OS in CI. Windows-only `cfg`
  branches compile/run on CI only (cannot build `cfg(windows)` on macOS).
- `grouping.rs` — Chrome-helper fixtures collapse to one `AppGroup`; standalone
  process stays single.
- `mod::kill` — refuses a `protected` pid without `confirmed`; honors it with
  `confirmed`; `force` selects SIGKILL. Use a small spawned dummy/sleep process
  for the real-kill path.
- `list` — sort order (cpu/memory/name) and query filtering correctness.

### SDK / IPC

- `ProcessServiceProxy` invokes `process:list` / `process:kill` (no `asyar:api:`
  prefix — MessageBroker adds it); proxy is in the **view** entry bag.
- Permission-gate test: `process:read` / `process:kill` mapped in the Rust gate
  (real) + JS `PERMISSION_MAP` mirror; manifest validates the new permission
  strings.

### Extension (vitest)

- `manifest.test.ts` guard (valid `PreferenceType` values — catches `"text"` vs
  `"textfield"`).
- View: protected row triggers the hard warning and only sends
  `confirmedProtected: true` after confirm; normal kill respects
  `skipConfirmation`; sort/query changes re-query Rust.

## Risks & open questions

- **App-grouping heuristic** is best-effort; some background daemons won't map to
  a friendly app name and will appear as single rows. Acceptable.
- **Elevated processes** may fail to kill without privilege escalation; reported
  per-pid, not escalated automatically.
- **CPU% accuracy** depends on `sysinfo` refresh timing; the first sample after
  launch may read low until a second refresh.
