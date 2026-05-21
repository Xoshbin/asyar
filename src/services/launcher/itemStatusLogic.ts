// Pure logic for deriving per-item dot status and per-kind aggregate counts
// from snapshots of runService.active / runService.keptAgents. No Svelte
// runes, no Tauri imports — trivially unit-testable. The reactive call
// sites (ResultsList, SectionedResultsList, ShowMoreBarHuds, +page.svelte's
// macOS HUD push effect) pass in the current snapshot each render.
//
// Lifecycle policy (user-locked):
//   - Scripts: succeeded scripts persist in runService.unacknowledgedScriptResults
//     as `run-done` rows; failed/cancelled stay in runService.unacknowledgedFailures
//     as `run-failed` rows. The script-definition row never lights up — the
//     run row carries the signal.
//   - Threads (agents): persist after success in runService.keptAgents
//     (deduped by subjectId — one row per agent) as `run-done` rows. The
//     agent-definition row never lights up — the run row carries the signal.

import type { RunKind, RunStatus } from 'asyar-sdk/contracts';

export type ItemStatus = 'active' | 'done' | 'failed';

/**
 * Structural subset of `Run` covering the fields the status logic actually
 * needs. Declaring it as its own type lets tests build fixtures without
 * also having to invent `label`, `cancellable`, etc.
 */
export interface RunSnapshot {
  id: string;
  kind: RunKind;
  status: RunStatus;
  subjectId?: string;
  startedAt: number;
  endedAt?: number;
}

function isActive(s: RunStatus): boolean {
  return s === 'pending' || s === 'running';
}

/**
 * "Is there a live or recent run for this subjectId?" Used by the script-
 * definition row to light up with a blue active dot while running, a green
 * done dot when a kept-success entry exists, or a red failed dot when an
 * unacknowledged failure exists. Active takes precedence over done; done
 * takes precedence over failed (a re-run that succeeds clears the prior
 * failed signal as soon as it's kept-saved).
 */
export function computeItemStatus(
  subjectId: string | undefined,
  active: RunSnapshot[],
  failed: RunSnapshot[] = [],
  succeeded: RunSnapshot[] = [],
): ItemStatus | null {
  if (!subjectId) return null;
  if (active.some(r => r.subjectId === subjectId && isActive(r.status))) return 'active';
  if (succeeded.some(r => r.subjectId === subjectId)) return 'done';
  if (failed.some(r => r.subjectId === subjectId)) return 'failed';
  return null;
}

export interface AggregateCounts {
  active: number;
  done: number;
}

/**
 * Counts shown in the single Show More bar HUD chip. Scripts and agents are
 * summed into one bucket each — the user requested a unified summary rather
 * than two separate per-kind chips. Sourced from three slices:
 *   - `active`        — live runs (runService.active). Both `shell-script`
 *                       and `agent` kinds with status `pending`/`running`
 *                       feed `active`.
 *   - `keptAgents`    — succeeded agent runs the user hasn't dismissed
 *                       (runService.keptAgents). Deduped by subjectId.
 *   - `scriptResults` — succeeded shell-script runs the user hasn't
 *                       dismissed (runService.unacknowledgedScriptResults).
 *                       Deduped by subjectId at the service layer.
 *
 * `done` = succeeded-and-kept of either kind, summed.
 *
 * `subjectId` is NOT required — the HUD is a machine-level aggregate, not
 * an item-row indicator. Anonymous Tier 2 runs (e.g. sdk-playground's
 * `shellService.spawn` without a Tier-1 dispatch wrapper) count too.
 */
export function aggregateKindCounts(
  active: RunSnapshot[],
  keptAgents: RunSnapshot[],
  scriptResults: RunSnapshot[] = [],
): AggregateCounts {
  let activeCount = 0;
  for (const r of active) {
    if ((r.kind === 'shell-script' || r.kind === 'agent') && isActive(r.status)) {
      activeCount++;
    }
  }
  return {
    active: activeCount,
    done: scriptResults.length + keptAgents.length,
  };
}

/**
 * Per-row status used by the launcher list components.
 *   - `type === 'run'`        → 'active'
 *   - `type === 'run-done'`   → 'done'
 *   - `type === 'run-failed'` → 'failed'
 *   - script-definition rows (`cmd_scripts_dyn_*`) climb into a status
 *     section by correlating against the live/failed/succeeded run lists
 *     (see computeItemStatus)
 *   - anything else           → null
 */
export function statusForRow(
  item: { type?: string; object_id: string },
  active: RunSnapshot[],
  failed: RunSnapshot[] = [],
  succeeded: RunSnapshot[] = [],
): ItemStatus | null {
  if (item.type === 'run') return 'active';
  if (item.type === 'run-done') return 'done';
  if (item.type === 'run-failed') return 'failed';
  if (item.object_id.startsWith('cmd_scripts_dyn_')) {
    return computeItemStatus(item.object_id, active, failed, succeeded);
  }
  return null;
}

/**
 * `startedAt` of the live run attributed to this row, or null when no run
 * is active for it. Mirrors the active-match branch of
 * `computeItemStatus` so the launcher list can show a live-ticking
 * elapsed chip next to the blue dot.
 *
 * `type === 'run'` rows correspond directly to a run (object_id IS the
 * run id) — the active list contains them. Definition rows
 * (cmd_scripts_dyn_*) match on subjectId, same rule as
 * computeItemStatus.
 */
export function runningStartedAtForRow(
  item: { type?: string; object_id: string },
  active: RunSnapshot[],
): number | null {
  if (item.type === 'run') {
    const r = active.find((r) => r.id === item.object_id && isActive(r.status));
    return r ? r.startedAt : null;
  }
  if (item.object_id.startsWith('cmd_scripts_dyn_')) {
    const r = active.find((r) => r.subjectId === item.object_id && isActive(r.status));
    return r ? r.startedAt : null;
  }
  return null;
}
