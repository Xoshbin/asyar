import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';
import { statusForRow, type RunSnapshot } from '../../services/launcher/itemStatusLogic';

export type SectionKey = 'failed' | 'done' | 'active' | 'commands';

export type SectionedRow =
  | { kind: 'header'; title: string; section: SectionKey }
  | { kind: 'item'; item: MappedSearchItem; originalIndex: number };

/**
 * Status-driven grouping. An item lands in Failed/Done/Active based on its
 * effective run status (see `statusForRow`):
 *   - Live `run` rows                           → Active
 *   - Script def rows (cmd_scripts_dyn_*) with
 *     a matching live run                       → Active
 *   - Kept-success `run-done` rows              → Done
 *   - Script defs with a kept-success result    → Done
 *   - `run-failed` rows                         → Failed
 *   - Script defs with an unack failure         → Failed
 *   - Everything else                           → Commands
 *
 * This means the def row itself climbs into the status section — when a
 * script is running, you see it under Active, not under Commands with a dot.
 */
export function categorizeItem(
  item: MappedSearchItem,
  active: RunSnapshot[],
  failed: RunSnapshot[] = [],
  succeeded: RunSnapshot[] = [],
): SectionKey {
  const status = statusForRow(item, active, failed, succeeded);
  if (status === 'active') return 'active';
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  return 'commands';
}

const SECTION_ORDER: SectionKey[] = ['failed', 'done', 'active', 'commands'];

const SECTION_TITLES: Record<SectionKey, string> = {
  failed: 'Failed',
  done: 'Done',
  active: 'Active',
  commands: 'Commands',
};

/**
 * Reorders items so the visual order matches the sectioned order
 * (Failed → Done → Active → Commands). Stable within each section.
 *
 * This is what makes keyboard ArrowUp/Down feel right: the underlying
 * selectedIndex walks the array in order, so re-sorting the array so it
 * matches what the user sees means up/down moves between visually adjacent
 * rows — no jumping across the list when a script promotes into Active.
 */
export function sortBySectionOrder(
  items: MappedSearchItem[],
  active: RunSnapshot[] = [],
  failed: RunSnapshot[] = [],
  succeeded: RunSnapshot[] = [],
): MappedSearchItem[] {
  const sectionRank: Record<SectionKey, number> = {
    failed: 0,
    done: 1,
    active: 2,
    commands: 3,
  };
  return items
    .map((item, originalIndex) => ({
      item,
      originalIndex,
      rank: sectionRank[categorizeItem(item, active, failed, succeeded)],
    }))
    .sort((a, b) => a.rank - b.rank || a.originalIndex - b.originalIndex)
    .map((entry) => entry.item);
}

export function buildSectionedView(
  items: MappedSearchItem[],
  active: RunSnapshot[] = [],
  failed: RunSnapshot[] = [],
  succeeded: RunSnapshot[] = [],
): SectionedRow[] {
  const buckets: Record<SectionKey, Array<{ item: MappedSearchItem; originalIndex: number }>> = {
    failed: [],
    done: [],
    active: [],
    commands: [],
  };

  for (let i = 0; i < items.length; i++) {
    const key = categorizeItem(items[i], active, failed, succeeded);
    buckets[key].push({ item: items[i], originalIndex: i });
  }

  const rows: SectionedRow[] = [];

  for (const section of SECTION_ORDER) {
    const bucket = buckets[section];
    if (bucket.length === 0) continue;

    rows.push({ kind: 'header', title: SECTION_TITLES[section], section });
    for (const entry of bucket) {
      rows.push({ kind: 'item', item: entry.item, originalIndex: entry.originalIndex });
    }
  }

  return rows;
}
