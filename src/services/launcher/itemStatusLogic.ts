// Pure logic for deriving per-item dot status and per-kind aggregate counts
// from snapshots of runService.active / runService.keptAgents. No Svelte
// runes, no Tauri imports — trivially unit-testable. The reactive call
// sites (ResultsList, SectionedResultsList, ShowMoreBarHuds, +page.svelte's
// macOS HUD push effect) pass in the current snapshot each render.
//
// Lifecycle policy (user-locked):
//   - Scripts: succeeded scripts persist in runService.unacknowledgedScriptResults
//     so the user can read the output until they dismiss. Failed/cancelled
//     run rows stay via runService.unacknowledgedFailures. The script-
//     definition row (cmd_scripts_dyn_*) lights up blue while a run is
//     active, green after success (until dismissed), red on failure.
//   - Threads (agents): persist after success in runService.keptAgents
//     (deduped by subjectId — one row per agent). User dismisses manually.
//     Failed/cancelled thread rows stay in unacknowledgedFailures like
//     scripts. Running threads appear as type:'run' rows (intrinsic blue).

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

export interface KindCounts {
  active: number;
  done: number;
}

export interface AggregateCounts {
  scripts: KindCounts;
  agents: KindCounts;
}

/**
 * Counts shown in the Show More bar HUD chips. Sourced from three slices:
 *   - `active`        — live runs (runService.active)
 *   - `keptAgents`    — succeeded agent runs the user hasn't dismissed
 *                       (runService.keptAgents). Deduped by subjectId.
 *   - `scriptResults` — succeeded shell-script runs the user hasn't
 *                       dismissed (runService.unacknowledgedScriptResults).
 *                       Deduped by subjectId at the service layer.
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
  const out: AggregateCounts = {
    scripts: { active: 0, done: 0 },
    agents:  { active: 0, done: 0 },
  };

  for (const r of active) {
    if (r.kind === 'shell-script' && isActive(r.status)) out.scripts.active++;
    else if (r.kind === 'agent' && isActive(r.status)) out.agents.active++;
  }
  out.scripts.done = scriptResults.length;
  out.agents.done = keptAgents.length;
  return out;
}

/**
 * Per-row status used by the launcher list components. Encodes the
 * row rules:
 *   1. `type === 'run'`        → 'active' (live run row).
 *   2. `type === 'run-done'`   → 'done'   (kept succeeded run: agent thread
 *                                          or script result).
 *   3. `type === 'run-failed'` → 'failed' (red dot on failed run rows).
 *   4. `cmd_scripts_dyn_*`     → 'active' if a matching live run exists,
 *                                else 'done' if a kept-success result
 *                                exists, else 'failed' if an unack failure
 *                                exists, else null.
 *   5. anything else (incl. `cmd_agents_dyn_*`) → null. Agent definitions
 *      stay quiet so the kept-thread row is the sole signal — no
 *      double-signal.
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
