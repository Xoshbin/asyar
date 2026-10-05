import { shortcutStore } from './shortcutStore.svelte';
import { findChordLosers } from './shortcutDedupe';

const AGENT_PREFIX = 'cmd_agents_dyn_';

/**
 * Remove shortcuts that lose a chord collision, preferring rows whose agent is
 * live. Removal goes through `shortcutStore.remove`, so the delete event also
 * writes a tombstone and the cloud copy is cleaned.
 *
 * Deliberately narrow: unique-chord rows are never touched, so apps, extension
 * commands that haven't loaded yet, and another device's agent shortcuts all
 * survive. Only agent rows can be judged dead; anything else counts as live.
 * Call only after the agents list has been fetched successfully.
 */
export function healDuplicateChords(liveAgentIds: ReadonlySet<string>): number {
  const losers = findChordLosers(shortcutStore.getAll(), (s) =>
    s.objectId.startsWith(AGENT_PREFIX)
      ? liveAgentIds.has(s.objectId.slice(AGENT_PREFIX.length))
      : true,
  );
  for (const loser of losers) shortcutStore.remove(loser.objectId);
  return losers.length;
}
