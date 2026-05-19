import { describe, it, expect } from 'vitest';
import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';
import { categorizeItem, buildSectionedView } from './sectionedListLogic';

// ── Factory ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<MappedSearchItem> = {}): MappedSearchItem {
  return {
    object_id: 'cmd_test_default',
    title: 'Test',
    score: 1,
    action: () => {},
    ...overrides,
  };
}

// ── categorizeItem ────────────────────────────────────────────────────────────

describe('categorizeItem', () => {
  it('returns "scripts" for a run item with typeLabel "Script"', () => {
    const item = makeItem({ type: 'run', typeLabel: 'Script' });
    expect(categorizeItem(item)).toBe('scripts');
  });

  it('returns "agents" for a run-failed item with typeLabel "Agent"', () => {
    const item = makeItem({ type: 'run-failed', typeLabel: 'Agent' });
    expect(categorizeItem(item)).toBe('agents');
  });

  it('returns "commands" for a run item with typeLabel "Run" (generic custom kind)', () => {
    const item = makeItem({ type: 'run', typeLabel: 'Run' });
    expect(categorizeItem(item)).toBe('commands');
  });

  it('returns "commands" for a command whose object_id starts with "cmd_agents_dyn_" (agent definitions are commands; only threads/runs land in Agents)', () => {
    const item = makeItem({ type: 'command', object_id: 'cmd_agents_dyn_abc123' });
    expect(categorizeItem(item)).toBe('commands');
  });

  it('returns "commands" for a command whose object_id starts with "cmd_scripts_dyn_" (script definitions are commands; only running/done/failed script rows land in Scripts)', () => {
    const item = makeItem({ type: 'command', object_id: 'cmd_scripts_dyn_xyz789' });
    expect(categorizeItem(item)).toBe('commands');
  });

  it('returns "commands" for an application item with an ordinary object_id', () => {
    const item = makeItem({ type: 'application', object_id: 'app_safari' });
    expect(categorizeItem(item)).toBe('commands');
  });

  it('returns "commands" for a generic command with a non-scripts/agents dynamic object_id', () => {
    const item = makeItem({ type: 'command', object_id: 'cmd_org.something_dyn_xyz' });
    expect(categorizeItem(item)).toBe('commands');
  });

  it('returns "commands" for a regular non-dynamic command', () => {
    const item = makeItem({ type: 'command', object_id: 'cmd_org.foo_bar' });
    expect(categorizeItem(item)).toBe('commands');
  });
});

// ── buildSectionedView ────────────────────────────────────────────────────────

describe('buildSectionedView', () => {
  it('returns an empty array for empty input', () => {
    expect(buildSectionedView([])).toEqual([]);
  });

  it('outputs headers in canonical Scripts → Agents → Commands order regardless of input order', () => {
    const agentThread = makeItem({ type: 'run', typeLabel: 'Agent', object_id: 'run_thread1', title: 'AgentThread' });
    const scriptRun = makeItem({ type: 'run', typeLabel: 'Script', object_id: 'run_script1', title: 'ScriptRun' });
    const commandItem = makeItem({ type: 'application', object_id: 'app_safari', title: 'Safari' });

    // Input order: agent-thread, script-run, command (intentionally scrambled)
    const rows = buildSectionedView([agentThread, scriptRun, commandItem]);

    expect(rows).toHaveLength(6); // 3 headers + 3 items
    expect(rows[0]).toMatchObject({ kind: 'header', section: 'scripts' });
    expect(rows[1]).toMatchObject({ kind: 'item' });
    expect(rows[2]).toMatchObject({ kind: 'header', section: 'agents' });
    expect(rows[3]).toMatchObject({ kind: 'item' });
    expect(rows[4]).toMatchObject({ kind: 'header', section: 'commands' });
    expect(rows[5]).toMatchObject({ kind: 'item' });
  });

  it('emits only one header for a single-section input with no empty buckets', () => {
    const s1 = makeItem({ type: 'run', typeLabel: 'Script', object_id: 'run_s1', title: 'ScriptA' });
    const s2 = makeItem({ type: 'run-done', typeLabel: 'Script', object_id: 'run_s2', title: 'ScriptB' });
    const s3 = makeItem({ type: 'run-failed', typeLabel: 'Script', object_id: 'run_s3', title: 'ScriptC' });

    const rows = buildSectionedView([s1, s2, s3]);

    expect(rows).toHaveLength(4); // 1 header + 3 items
    expect(rows[0]).toMatchObject({ kind: 'header', section: 'scripts' });
    expect(rows[1]).toMatchObject({ kind: 'item' });
    expect(rows[2]).toMatchObject({ kind: 'item' });
    expect(rows[3]).toMatchObject({ kind: 'item' });
  });

  it('preserves relative order within a section', () => {
    const scriptRunA = makeItem({ type: 'run',        typeLabel: 'Script', object_id: 'run_sa', title: 'ScriptA' });
    const agentRunX  = makeItem({ type: 'run',        typeLabel: 'Agent',  object_id: 'run_ax', title: 'AgentX'  });
    const scriptRunB = makeItem({ type: 'run-done',   typeLabel: 'Script', object_id: 'run_sb', title: 'ScriptB' });
    const scriptRunC = makeItem({ type: 'run-failed', typeLabel: 'Script', object_id: 'run_sc', title: 'ScriptC' });

    const rows = buildSectionedView([scriptRunA, agentRunX, scriptRunB, scriptRunC]);

    // Scripts header + scriptA, scriptB, scriptC in that order; then Agents header + agentX
    const scriptItems = rows.filter(
      (r) => r.kind === 'item' && (r as { kind: 'item'; item: MappedSearchItem; originalIndex: number }).item.typeLabel === 'Script'
    ) as { kind: 'item'; item: MappedSearchItem; originalIndex: number }[];

    expect(scriptItems).toHaveLength(3);
    expect(scriptItems[0].item.title).toBe('ScriptA');
    expect(scriptItems[1].item.title).toBe('ScriptB');
    expect(scriptItems[2].item.title).toBe('ScriptC');
  });

  it('round-trips originalIndex so downstream selection stays correct', () => {
    const a = makeItem({ type: 'run', typeLabel: 'Script', object_id: 'run_a', title: 'A' });  // index 0 → scripts
    const b = makeItem({ type: 'application', object_id: 'app_b', title: 'B' });               // index 1 → commands
    const c = makeItem({ type: 'run-done', typeLabel: 'Script', object_id: 'run_c', title: 'C' }); // index 2 → scripts
    const d = makeItem({ type: 'application', object_id: 'app_d', title: 'D' });               // index 3 → commands

    const rows = buildSectionedView([a, b, c, d]);

    const itemRows = rows.filter((r) => r.kind === 'item') as {
      kind: 'item';
      item: MappedSearchItem;
      originalIndex: number;
    }[];

    // Expected layout: [header scripts, item a(0), item c(2), header commands, item b(1), item d(3)]
    expect(itemRows).toHaveLength(4);
    expect(itemRows[0].originalIndex).toBe(0); // scriptRunA
    expect(itemRows[1].originalIndex).toBe(2); // scriptRunC
    expect(itemRows[2].originalIndex).toBe(1); // appB
    expect(itemRows[3].originalIndex).toBe(3); // appD
  });

  it('scripts header has title "Scripts" and section "scripts"', () => {
    const item = makeItem({ type: 'run', typeLabel: 'Script', object_id: 'run_s1' });
    const rows = buildSectionedView([item]);
    const header = rows.find((r) => r.kind === 'header') as { kind: 'header'; title: string; section: string };
    expect(header.title).toBe('Scripts');
    expect(header.section).toBe('scripts');
  });

  it('agents header has title "Agents" and section "agents"', () => {
    const item = makeItem({ type: 'run', typeLabel: 'Agent', object_id: 'run_thread1' });
    const rows = buildSectionedView([item]);
    const header = rows.find((r) => r.kind === 'header') as { kind: 'header'; title: string; section: string };
    expect(header.title).toBe('Agents');
    expect(header.section).toBe('agents');
  });

  it('commands header has title "Commands" and section "commands"', () => {
    const item = makeItem({ type: 'application', object_id: 'app_safari' });
    const rows = buildSectionedView([item]);
    const header = rows.find((r) => r.kind === 'header') as { kind: 'header'; title: string; section: string };
    expect(header.title).toBe('Commands');
    expect(header.section).toBe('commands');
  });
});
