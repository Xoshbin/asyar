// Pure logic for deriving per-item dot status and per-kind aggregate counts
// from snapshots of runService.active / runService.keptAgents. No Svelte
// runes, no Tauri imports — trivially unit-testable. The reactive call
// sites (ResultsList, SectionedResultsList, CompactHud) pass in the current
// snapshot each render.
//
// Lifecycle policy (user-locked):
//   - Scripts: auto-remove on success. Failed/cancelled run rows stay via
//     runService.unacknowledgedFailures (no dot — subtitle handles it).
//     The script-definition row (cmd_scripts_dyn_*) lights up blue only
//     while a run is active; never green-after-success.
//   - Threads (agents): persist after success in runService.keptAgents
//     (deduped by subjectId — one row per agent). User dismisses manually.
//     Failed/cancelled thread rows stay in unacknowledgedFailures like
//     scripts. Running threads appear as type:'run' rows (intrinsic blue).

import type { RunKind, RunStatus } from 'asyar-sdk/contracts';

export type ItemStatus = 'active' | 'done';

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
 * "Is there a live run for this subjectId?" Used by the script-definition
 * row to light up while the script is running. Returns null otherwise —
 * succeeded scripts auto-remove (no green-dot persistence), so we never
 * return 'done' from a recent-list lookup.
 */
export function computeItemStatus(
  subjectId: string | undefined,
  active: RunSnapshot[],
): ItemStatus | null {
  if (!subjectId) return null;
  if (active.some(r => r.subjectId === subjectId && isActive(r.status))) return 'active';
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
 * Counts shown in the Compact HUD. Sourced from two reactive slices:
 *   - `active`        — live runs (runService.active)
 *   - `keptAgents`    — succeeded agent runs the user hasn't dismissed
 *                       (runService.keptAgents). Already deduped by
 *                       subjectId at the service layer, so .length gives
 *                       the per-agent kept-thread count.
 *
 * Scripts never contribute to `.done` — succeeded scripts auto-remove from
 * the launcher entirely, including the HUD aggregate.
 *
 * Runs without a subjectId are excluded from `.active` counts — they would
 * inflate the HUD with anonymous Tier 2 runs that have no item to attribute
 * to. (keptAgents is always subjectId-tagged since agentLoop sets it.)
 */
export function aggregateKindCounts(
  active: RunSnapshot[],
  keptAgents: RunSnapshot[],
): AggregateCounts {
  const out: AggregateCounts = {
    scripts: { active: 0, done: 0 },
    agents:  { active: 0, done: 0 },
  };

  for (const r of active) {
    if (!r.subjectId) continue;
    if (r.kind === 'shell-script' && isActive(r.status)) out.scripts.active++;
    else if (r.kind === 'agent'   && isActive(r.status)) out.agents.active++;
  }
  out.agents.done = keptAgents.length;
  return out;
}

/**
 * Per-row status used by the launcher list components. Encodes the
 * four-class row rule:
 *   1. `type === 'run'`        → 'active' (live run row).
 *   2. `type === 'run-done'`   → 'done'   (succeeded agent run that the
 *                                          user has not yet dismissed).
 *   3. `type === 'run-failed'` → null     (subtitle conveys failure).
 *   4. `cmd_scripts_dyn_*`     → 'active' if a matching live run exists;
 *                                otherwise null. Succeeded scripts
 *                                auto-remove, so we never light up the
 *                                definition row green.
 *   5. anything else (incl. `cmd_agents_dyn_*`) → null. Agent definitions
 *      stay quiet so the kept-thread row in Agents section is the sole
 *      signal — no double-signal.
 */
export function statusForRow(
  item: { type?: string; object_id: string },
  active: RunSnapshot[],
): ItemStatus | null {
  if (item.type === 'run') return 'active';
  if (item.type === 'run-done') return 'done';
  if (item.type === 'run-failed') return null;
  if (item.object_id.startsWith('cmd_scripts_dyn_')) {
    return computeItemStatus(item.object_id, active);
  }
  return null;
}
