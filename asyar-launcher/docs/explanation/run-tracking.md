---
order: 13
---
# Run Tracking — Lifecycle, Sections, and Status Dots

The run-tracking system gives the launcher a durable record of long-running work. A run persists through view eviction and panel close, remains visible in the runs UI and compact HUD, drives the tray badge count, and triggers a system notification on failure. This page explains how the system is structured and why it behaves the way it does. For the SDK surface that extensions call into, see [RunService — SDK reference](../reference/sdk/run-service.md).

## Why runs exist

Asyar treats some work as fundamentally asynchronous: a shell script might run for minutes; an agent thread makes a sequence of LLM calls across multiple turns. The user can close the panel, switch apps, and return later. If the record of that work lived only inside a view iframe, it would be silently lost the moment the view was evicted — typically 120 seconds after the panel closes. Runs are the answer to that fragility: they live in an in-memory registry backed by SQLite, broadcast state changes to the frontend via Tauri events, and survive view eviction entirely because the `RunService` singleton on the launcher side (not inside any extension iframe) owns the slices that drive the list.

## The lifecycle

A run moves through these states:

```
         starts here
              │
           active ──────► succeeded
              │
              ├──────────► failed
              │
              └──────────► cancelled
```

In production, `runs_start_impl` in `src-tauri/src/commands/runs.rs` creates every run with `RunStatus::Running` (which maps to `active` on the TypeScript side) immediately. There is no observable `pending` phase in built-in dispatch paths or in `RunService.start()`. The status `pending` exists in the type alphabet — the SDK contract, the Rust enum, and `isActive()` in `itemStatusLogic.ts` all accept it — and `registry.list_active()` includes it in the active set. However, no built-in dispatch site or public SDK call emits a run in the pending state; it is a reserved slot for future use.

Once active, a run transitions to exactly one terminal state:

- **`succeeded`** — normal completion. Scripts auto-remove from the launcher; agent threads move to the kept-agents slice.
- **`failed`** — error completion. The run stays visible until the user dismisses it. A system notification is also sent.
- **`cancelled`** — user-initiated cancellation. The run vanishes immediately.

The `runs:state-changed` Tauri event carries the updated `Run` payload for every transition, and `RunService.onStateChanged()` is the single place that applies those transitions to the reactive slices the list renders from.

`searchResultMapper.buildRunMappedItem` is the single point that converts a `Run.status` into a display row type: `failed` → `'run-failed'`, `succeeded` → `'run-done'`, anything else → `'run'`. Both section routing and dot rendering are driven by that row type — there is no secondary lookup.

For context on why the worker iframe is the right place to start runs from an extension, and why runs must not depend on view-iframe lifetime, see [Extension Runtime](./extension-runtime.md).

## The `subjectId` join key

A `Run` carries an optional `subjectId` string that ties it back to its originating launcher item. The join is a direct equality check: the run's `subjectId` equals the launcher item's `object_id`. This is what lets the launcher light up a status dot on a script definition row while that script is running, and extinguish it when the run finishes.

Two built-in dispatch sites set it:

- **Scripts** — `src/built-in-features/scripts/dispatch.ts` sets `subjectId: 'cmd_scripts_dyn_<dynamicId>'`, where `dynamicId` is the script's registered dynamic command ID.
- **Agents** — `src/built-in-features/agents/agentLoop.ts` sets `subjectId: 'cmd_agents_dyn_<agentId>'`. This is keyed per agent, not per thread: if the user starts two concurrent threads of the same agent, both runs share one `subjectId` and therefore share one status dot in the list. The design choice here was to show a single per-agent signal rather than multiply the dots with each thread.

Ad-hoc runs started via `RunService.start()` from a Tier 2 extension leave `subjectId` undefined — the public `RunStartInput` type has no such field, so third-party extensions cannot set it. Only built-in dispatch sites produce the join.

The `subjectId` travels the full stack: `Run.subject_id` as `Option<String>` in Rust, persisted in the `runs_history.subject_id` TEXT column in SQLite, serialised as camelCase `subjectId` on the wire, and typed as `subjectId?: string` on the `Run` interface in `asyar-sdk/contracts/runs.ts`.

## Section routing — Scripts, Agents, Commands

`SectionedResultsList.svelte` renders the launcher's home view (empty search bar) as three named sections. The sections are a render-time projection over a single flat `MappedSearchItem[]` list. The underlying list keeps its original indices — keyboard navigation and the selection layer are unaffected.

`categorizeItem` in `src/components/list/sectionedListLogic.ts` assigns each item to a section key:

| Item characteristics | Section |
|---|---|
| `type === 'run' \| 'run-failed' \| 'run-done'` and `typeLabel === 'Script'` | Scripts |
| `type === 'run' \| 'run-failed' \| 'run-done'` and `typeLabel === 'Agent'` | Agents |
| `object_id.startsWith('cmd_scripts_dyn_')` | Scripts |
| everything else (including `cmd_agents_dyn_*`) | Commands |

The asymmetry between scripts and agents is intentional. Script definition rows (`cmd_scripts_dyn_*`) belong alongside the live run rows they can carry dots for, so they land in Scripts. Agent definition rows (`cmd_agents_dyn_*`) are launchers for new threads, not records of running threads, so they land in Commands. Only live or recently finished threads — the actual `run` / `run-done` rows — appear in the Agents section.

Section header rows are introduced by `buildSectionedView` at render time and exist only in the `SectionedRow[]` that the component consumes. They are not part of `MappedSearchItem` and play no role in keyboard index arithmetic.

## Run-state dot policy

Each row in the launcher list optionally displays a status dot. `statusForRow` in `src/services/launcher/itemStatusLogic.ts` encodes the five rules both list components call once per rendered row:

1. **`type === 'run'`** → `'active'`. A pulsing blue dot indicating work is in progress. This covers every live run regardless of kind.
2. **`type === 'run-done'`** → `'done'`. A static green dot on a kept agent thread row, indicating the thread succeeded and is waiting for dismissal.
3. **`type === 'run-failed'`** → `null`. No dot. The subtitle already reads "Failed · …" — a danger-coloured dot would repeat the signal without adding information.
4. **`object_id.startsWith('cmd_scripts_dyn_')`** → `'active'` while a matching live run exists in the active slice; otherwise `null`. Script definition rows never receive a `'done'` dot: succeeded scripts auto-remove their run rows from the launcher entirely, so there is nothing to persist a green signal against.
5. **`object_id.startsWith('cmd_agents_dyn_')` and everything else** → `null`. Agent definition rows stay quiet; the `run` / `run-done` row in the Agents section is the sole signal. Lighting up both the definition and the thread row would double-signal the same running state.

`ItemStatus` is `'active' | 'done' | 'failed'`.

## Run-row lifecycle policy

The launcher keeps three kinds of post-mortem rows so the user always sees how a run ended:

**Scripts are persistent until dismissed.** When a shell-script run succeeds, `runService.onStateChanged` pushes it into `runService.unacknowledgedScriptResults` (deduped by `subjectId` when present, else by id, capped at five). The script definition row (`cmd_scripts_dyn_*`) stays decorated with a green `done` dot and a `Done · {tailOutput}` subtitle until the user dismisses via Cmd+K → Dismiss Result, which calls `runService.dismissScriptResult(id)` — that filters the slice and invokes `runs_dismiss` to free the in-memory `OutputBuffer`. A "Script finished" system notification is fired on completion, carrying the tail-output preview.

**Agent threads are persistent until dismissed.** When an agent run succeeds, `runService.onStateChanged` moves it into `runService.keptAgents`. The slice is deduped by `subjectId`: if an agent has two concurrent threads and both succeed, only the most recent successful run is kept, so each agent shows at most one `run-done` row at a time. Kept rows render as `type:'run-done'` with a static green dot until the user explicitly dismisses them (Cmd+K → Dismiss Thread), which calls `runService.dismissKeptAgent(id)`. No success notification fires for agents (the kept-thread row is the surface).

**Failures, any kind:** failed runs are moved from the active slice into `runService.unacknowledgedFailures`, capped at five entries. They render as `type:'run-failed'` rows with a red `failed` dot and `Failed · {tailOutput ?? errorMessage}` subtitle until dismissed (Cmd+K → Dismiss Failure). A "Run failed" notification carries the tail-output preview.

**Cancellations, any kind:** cancelled runs leave the active slice and enter no kept slice. The row disappears immediately. Cancellation is always user-initiated — the act of cancelling is itself the closure signal.

The three kept slices (`unacknowledgedFailures`, `keptAgents`, `unacknowledgedScriptResults`) are in-memory only and reset when the launcher restarts. The full run history (including `Run.tailOutput`) is persisted in SQLite and surfaced in the RunView recent section. The per-run `OutputBuffer` survives finalize and is dropped only by explicit `runs_dismiss` or session reset.

## Cross-references

- [RunService — SDK reference](../reference/sdk/run-service.md) — the public API that Tier 2 extensions call to start, write, and finish runs.
- [Script Headers](../reference/script-headers.md) — `# @asyar.*` directives for user scripts, including `mode: inline` (which deliberately *bypasses* the Run Tracker so live-ticking subtitles don't pollute the kept-Done slice).
- [Extension Runtime](./extension-runtime.md) — worker-survives-Dormant context; why long-running work must be anchored to the worker iframe, not the view.
- [Two-Tier Model](./two-tier-model.md) — Tier 1 (built-in features, direct host access) vs Tier 2 (sandbox iframe); why `subjectId` is only settable from built-in dispatch sites.
