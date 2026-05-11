// Pure helpers for the inline "Running" section displayed above search results
// when at least one Run is active. Kept free of Svelte runes and Tauri imports
// so they are trivially unit-testable — the stateful wiring lives in
// RunningSection.svelte.

import type { Run, RunKind } from 'asyar-sdk/contracts';

export interface RunGroup {
  title: string;
  runs: Run[];
}

const SCRIPTS_KINDS: ReadonlyArray<RunKind> = ['shell-script'];
const AGENTS_KINDS: ReadonlyArray<RunKind> = ['agent'];
const OTHER_KINDS: ReadonlyArray<RunKind> = ['custom'];

/**
 * Group active runs by kind into ordered UI sections. Empty sections are
 * omitted. Output order: Scripts, Agents, Other.
 */
export function groupRunsByKind(runs: Run[]): RunGroup[] {
  const scripts = runs.filter(r => SCRIPTS_KINDS.includes(r.kind));
  const agents = runs.filter(r => AGENTS_KINDS.includes(r.kind));
  const other = runs.filter(r => OTHER_KINDS.includes(r.kind));

  const groups: RunGroup[] = [];
  if (scripts.length) groups.push({ title: 'Scripts', runs: scripts });
  if (agents.length) groups.push({ title: 'Agents', runs: agents });
  if (other.length) groups.push({ title: 'Other', runs: other });
  return groups;
}

/**
 * Format elapsed milliseconds as a short human-readable string.
 * < 60 000 ms  → "12s"
 * < 3 600 000 ms → "5m"
 * >= 3 600 000 ms → "2h"
 */
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  return `${totalHours}h`;
}

/**
 * Pick a status icon name for the given Run status. Used by the RunningSection
 * row's leading icon slot.
 */
export function statusIconName(status: Run['status']): string {
  switch (status) {
    case 'pending':
    case 'running':
      return 'activity';
    case 'succeeded':
      return 'arrow-up-circle';
    case 'failed':
      return 'info';
    case 'cancelled':
      return 'refresh';
  }
}
