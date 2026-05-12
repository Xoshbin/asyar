import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';

export type SectionKey = 'scripts' | 'agents' | 'commands';

export type SectionedRow =
  | { kind: 'header'; title: string; section: SectionKey }
  | { kind: 'item'; item: MappedSearchItem; originalIndex: number };

export function categorizeItem(item: MappedSearchItem): SectionKey {
  if (item.type === 'run' || item.type === 'run-failed') {
    if (item.typeLabel === 'Script') return 'scripts';
    if (item.typeLabel === 'Agent') return 'agents';
    return 'commands';
  }
  // Script dynamic commands ARE the scripts themselves — keep in Scripts.
  // Agent dynamic commands are agent definitions, not threads — only running
  // threads (run items with typeLabel 'Agent') land in the Agents section.
  if (item.object_id.startsWith('cmd_scripts_dyn_')) return 'scripts';
  return 'commands';
}

const SECTION_ORDER: SectionKey[] = ['scripts', 'agents', 'commands'];

const SECTION_TITLES: Record<SectionKey, string> = {
  scripts: 'Scripts',
  agents: 'Agents',
  commands: 'Commands',
};

export function buildSectionedView(items: MappedSearchItem[]): SectionedRow[] {
  const buckets: Record<SectionKey, Array<{ item: MappedSearchItem; originalIndex: number }>> = {
    scripts: [],
    agents: [],
    commands: [],
  };

  for (let i = 0; i < items.length; i++) {
    const key = categorizeItem(items[i]);
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
