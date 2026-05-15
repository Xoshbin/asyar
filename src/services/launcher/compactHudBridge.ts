// Compact-mode HUD bridge — pushes aggregate Scripts/Agents run counts to the
// native macOS Show More bar, which renders the chips as NSView subviews
// alongside the existing "Show More ↓" affordance.
//
// On non-macOS the bar is a Svelte overlay in BottomActionBar.svelte; the
// chips render inline there from the same `aggregateKindCounts` source, so
// this bridge is a no-op outside macOS.
//
// Dedup: aggregateKindCounts is re-derived on every runService.active write
// (heavy reactive surface), so we cache the last pushed payload and skip the
// IPC round-trip when nothing changed. Rust would no-op too, but the cheaper
// check is here.

import { platform } from '@tauri-apps/plugin-os';
import {
  updateShowMoreBarHuds,
  type ShowMoreBarHudsPayload,
} from '../../lib/ipc/commands';
import type { AggregateCounts } from './itemStatusLogic';
import { logService } from '../log/logService';

const IS_MACOS = (() => {
  try { return platform() === 'macos'; } catch { return false; }
})();

let lastPushed: ShowMoreBarHudsPayload | null = null;

function payloadFor(counts: AggregateCounts): ShowMoreBarHudsPayload {
  return {
    scripts_active: counts.scripts.active,
    scripts_done: counts.scripts.done,
    agents_active: counts.agents.active,
    agents_done: counts.agents.done,
  };
}

function samePayload(a: ShowMoreBarHudsPayload, b: ShowMoreBarHudsPayload): boolean {
  return a.scripts_active === b.scripts_active
    && a.scripts_done === b.scripts_done
    && a.agents_active === b.agents_active
    && a.agents_done === b.agents_done;
}

/**
 * Push the current aggregate counts to the native Show More bar. Idempotent
 * across identical inputs. First call after module load always pushes (even
 * if all zero) so the native bar's freshly-built subview state gets a
 * deterministic "hide everything" signal on quiet systems.
 */
export async function pushShowMoreBarHuds(counts: AggregateCounts): Promise<void> {
  if (!IS_MACOS) return;
  const next = payloadFor(counts);
  if (lastPushed && samePayload(lastPushed, next)) return;
  lastPushed = next;
  try {
    await updateShowMoreBarHuds(next);
  } catch (e) {
    logService.debug(`[compactHudBridge] updateShowMoreBarHuds failed: ${e}`);
  }
}

/** Test-only: clear the dedup cache so each test starts from a clean state. */
export function __resetForTests(): void {
  lastPushed = null;
}
