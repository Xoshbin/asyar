import { normalizeShortcut } from './shortcutFormatter';
import type { ItemShortcut } from './shortcutStore.svelte';

type Liveness = (s: ItemShortcut) => boolean;

/**
 * Deterministic ordering for two shortcuts claiming the same chord. A row whose
 * target is known to be live beats one that isn't; then the newer `createdAt`
 * wins; then the larger `objectId`. The last tie-break matters because every
 * synced device must pick the same winner, or each would tombstone the other's.
 */
export function outranks(a: ItemShortcut, b: ItemShortcut, isLive?: Liveness): boolean {
  if (isLive) {
    const aLive = isLive(a);
    const bLive = isLive(b);
    if (aLive !== bLive) return aLive;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.objectId > b.objectId;
}

/**
 * Rows that lose a chord collision. Only chord duplicates are ever returned:
 * a row with a unique chord is never a loser, however dead its target looks,
 * because ids like `cmd_agents_dyn_<id>` are per-device and the row may belong
 * to another device's still-live agent.
 */
export function findChordLosers(all: ItemShortcut[], isLive?: Liveness): ItemShortcut[] {
  const winners = new Map<string, ItemShortcut>();
  const losers: ItemShortcut[] = [];
  for (const s of all) {
    const key = normalizeShortcut(s.shortcut);
    const current = winners.get(key);
    if (!current) {
      winners.set(key, s);
    } else if (outranks(s, current, isLive)) {
      losers.push(current);
      winners.set(key, s);
    } else {
      losers.push(s);
    }
  }
  return losers;
}
