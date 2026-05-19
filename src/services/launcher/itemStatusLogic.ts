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
 * Per-row status used by the launcher list components. Pure type-driven:
 *   - `type === 'run'`        → 'active'
 *   - `type === 'run-done'`   → 'done'
 *   - `type === 'run-failed'` → 'failed'
 *   - anything else           → null (def rows are "what you can invoke";
 *                                     run rows carry the status signal)
 */
export function statusForRow(
  item: { type?: string; object_id: string },
): ItemStatus | null {
  if (item.type === 'run') return 'active';
  if (item.type === 'run-done') return 'done';
  if (item.type === 'run-failed') return 'failed';
  return null;
}
