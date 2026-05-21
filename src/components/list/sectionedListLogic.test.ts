import { describe, it, expect } from 'vitest';
import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';
import type { RunSnapshot } from '../../services/launcher/itemStatusLogic';
import { categorizeItem, buildSectionedView, sortBySectionOrder } from './sectionedListLogic';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<MappedSearchItem> = {}): MappedSearchItem {
  return {
    object_id: 'cmd_test_default',
    title: 'Test',
    score: 1,
    action: () => {},
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: 'run_default',
    kind: 'shell-script',
    status: 'running',
    startedAt: 0,
    ...overrides,
  };
}

// ── categorizeItem ────────────────────────────────────────────────────────────

describe('categorizeItem', () => {
  it('returns "active" for a live run row', () => {
    expect(categorizeItem(makeItem({ type: 'run' }), [], [], [])).toBe('active');
  });

  it('returns "done" for a run-done row', () => {
    expect(categorizeItem(makeItem({ type: 'run-done' }), [], [], [])).toBe('done');
  });

  it('returns "failed" for a run-failed row', () => {
    expect(categorizeItem(makeItem({ type: 'run-failed' }), [], [], [])).toBe('failed');
  });

  it('returns "active" for a script def row whose subjectId matches a running run', () => {
    const def = makeItem({ type: 'command', object_id: 'cmd_scripts_dyn_foo' });
    const active = [makeRun({ id: 'run_1', subjectId: 'cmd_scripts_dyn_foo', status: 'running' })];
    expect(categorizeItem(def, active, [], [])).toBe('active');
  });

  it('returns "done" for a script def row with a kept-success result and no live run', () => {
    const def = makeItem({ type: 'command', object_id: 'cmd_scripts_dyn_foo' });
    const succeeded = [makeRun({ id: 'run_1', subjectId: 'cmd_scripts_dyn_foo', status: 'succeeded', endedAt: 1 })];
    expect(categorizeItem(def, [], [], succeeded)).toBe('done');
  });

  it('returns "failed" for a script def row with only an unack failure', () => {
    const def = makeItem({ type: 'command', object_id: 'cmd_scripts_dyn_foo' });
    const failed = [makeRun({ id: 'run_1', subjectId: 'cmd_scripts_dyn_foo', status: 'failed', endedAt: 1 })];
    expect(categorizeItem(def, [], failed, [])).toBe('failed');
  });

  it('returns "commands" for a script def row with no associated run', () => {
    const def = makeItem({ type: 'command', object_id: 'cmd_scripts_dyn_foo' });
    expect(categorizeItem(def, [], [], [])).toBe('commands');
  });

  it('returns "commands" for an agent def row (cmd_agents_dyn_*) even with matching runs — defs only light up for scripts', () => {
    const def = makeItem({ type: 'command', object_id: 'cmd_agents_dyn_abc' });
    const active = [makeRun({ id: 'run_1', subjectId: 'cmd_agents_dyn_abc', status: 'running' })];
    expect(categorizeItem(def, active, [], [])).toBe('commands');
  });

  it('returns "commands" for an application item', () => {
    expect(categorizeItem(makeItem({ type: 'application', object_id: 'app_safari' }), [], [], [])).toBe('commands');
  });

  it('returns "commands" for a regular non-dynamic command', () => {
    expect(categorizeItem(makeItem({ type: 'command', object_id: 'cmd_org.foo_bar' }), [], [], [])).toBe('commands');
  });
});

// ── buildSectionedView ────────────────────────────────────────────────────────

describe('buildSectionedView', () => {
  it('returns an empty array for empty input', () => {
    expect(buildSectionedView([], [], [], [])).toEqual([]);
  });

  it('outputs headers in canonical Failed → Done → Active → Commands order regardless of input order', () => {
    const liveRun = makeItem({ type: 'run', object_id: 'run_live', title: 'LiveRun' });
    const keptResult = makeItem({ type: 'run-done', object_id: 'run_done', title: 'KeptResult' });
    const failedResult = makeItem({ type: 'run-failed', object_id: 'run_failed', title: 'FailedResult' });
    const commandItem = makeItem({ type: 'application', object_id: 'app_safari', title: 'Safari' });

    const rows = buildSectionedView([liveRun, commandItem, failedResult, keptResult], [], [], []);

    expect(rows).toHaveLength(8); // 4 headers + 4 items
    expect(rows[0]).toMatchObject({ kind: 'header', section: 'failed' });
    expect(rows[1]).toMatchObject({ kind: 'item' });
    expect(rows[2]).toMatchObject({ kind: 'header', section: 'done' });
    expect(rows[3]).toMatchObject({ kind: 'item' });
    expect(rows[4]).toMatchObject({ kind: 'header', section: 'active' });
    expect(rows[5]).toMatchObject({ kind: 'item' });
    expect(rows[6]).toMatchObject({ kind: 'header', section: 'commands' });
    expect(rows[7]).toMatchObject({ kind: 'item' });
  });

  it('promotes script def rows into Active when they have a matching running run', () => {
    const defA = makeItem({ type: 'command', object_id: 'cmd_scripts_dyn_a', title: 'A' });
    const defB = makeItem({ type: 'command', object_id: 'cmd_scripts_dyn_b', title: 'B' });
    const idle = makeItem({ type: 'application', object_id: 'app_safari', title: 'Safari' });

    const active = [makeRun({ id: 'r1', subjectId: 'cmd_scripts_dyn_a', status: 'running' })];

    const rows = buildSectionedView([defA, defB, idle], active, [], []);

    // defA → Active, defB + idle → Commands
    expect(rows[0]).toMatchObject({ kind: 'header', section: 'active' });
    expect((rows[1] as { kind: 'item'; item: MappedSearchItem; originalIndex: number }).item.title).toBe('A');
    expect(rows[2]).toMatchObject({ kind: 'header', section: 'commands' });
    expect((rows[3] as { kind: 'item'; item: MappedSearchItem; originalIndex: number }).item.title).toBe('B');
    expect((rows[4] as { kind: 'item'; item: MappedSearchItem; originalIndex: number }).item.title).toBe('Safari');
  });

  it('omits headers for empty sections — status sections only appear when populated', () => {
    const commandItem = makeItem({ type: 'application', object_id: 'app_safari' });
    const rows = buildSectionedView([commandItem], [], [], []);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'header', section: 'commands' });
    expect(rows[1]).toMatchObject({ kind: 'item' });
    expect(rows.find((r) => r.kind === 'header' && r.section !== 'commands')).toBeUndefined();
  });

  it('preserves relative order within a section', () => {
    const a = makeItem({ type: 'run', object_id: 'run_a', title: 'A' });
    const x = makeItem({ type: 'application', object_id: 'app_x', title: 'X' });
    const b = makeItem({ type: 'run', object_id: 'run_b', title: 'B' });
    const c = makeItem({ type: 'run', object_id: 'run_c', title: 'C' });

    const rows = buildSectionedView([a, x, b, c], [], [], []);

    const activeItems = rows.filter(
      (r) => r.kind === 'item' && (r as { kind: 'item'; item: MappedSearchItem; originalIndex: number }).item.type === 'run',
    ) as { kind: 'item'; item: MappedSearchItem; originalIndex: number }[];

    expect(activeItems).toHaveLength(3);
    expect(activeItems[0].item.title).toBe('A');
    expect(activeItems[1].item.title).toBe('B');
    expect(activeItems[2].item.title).toBe('C');
  });

  it('round-trips originalIndex so downstream selection stays correct', () => {
    const a = makeItem({ type: 'run', object_id: 'run_a', title: 'A' });          // 0 → active
    const b = makeItem({ type: 'application', object_id: 'app_b', title: 'B' });    // 1 → commands
    const c = makeItem({ type: 'run', object_id: 'run_c', title: 'C' });          // 2 → active
    const d = makeItem({ type: 'application', object_id: 'app_d', title: 'D' });    // 3 → commands

    const rows = buildSectionedView([a, b, c, d], [], [], []);

    const itemRows = rows.filter((r) => r.kind === 'item') as {
      kind: 'item';
      item: MappedSearchItem;
      originalIndex: number;
    }[];

    expect(itemRows).toHaveLength(4);
    expect(itemRows[0].originalIndex).toBe(0); // runA
    expect(itemRows[1].originalIndex).toBe(2); // runC
    expect(itemRows[2].originalIndex).toBe(1); // appB
    expect(itemRows[3].originalIndex).toBe(3); // appD
  });

  it('section headers have the expected titles', () => {
    const cases: Array<[Partial<MappedSearchItem>, string, string]> = [
      [{ type: 'run-failed', object_id: 'run_x' }, 'Failed', 'failed'],
      [{ type: 'run-done', object_id: 'run_x' }, 'Done', 'done'],
      [{ type: 'run', object_id: 'run_x' }, 'Active', 'active'],
      [{ type: 'application', object_id: 'app_safari' }, 'Commands', 'commands'],
    ];
    for (const [overrides, title, section] of cases) {
      const rows = buildSectionedView([makeItem(overrides)], [], [], []);
      const header = rows.find((r) => r.kind === 'header') as { kind: 'header'; title: string; section: string };
      expect(header.title).toBe(title);
      expect(header.section).toBe(section);
    }
  });
});

// ── sortBySectionOrder ────────────────────────────────────────────────────────

describe('sortBySectionOrder', () => {
  it('returns items in Failed → Done → Active → Commands order, stable within each section', () => {
    const liveRun = makeItem({ type: 'run', object_id: 'run_live', title: 'LiveRun' });
    const keptResult = makeItem({ type: 'run-done', object_id: 'run_done', title: 'KeptResult' });
    const failedResult = makeItem({ type: 'run-failed', object_id: 'run_failed', title: 'FailedResult' });
    const app = makeItem({ type: 'application', object_id: 'app_safari', title: 'Safari' });
    const cmd = makeItem({ type: 'command', object_id: 'cmd_org.foo', title: 'Foo' });

    const out = sortBySectionOrder([liveRun, cmd, failedResult, keptResult, app], [], [], []);

    expect(out.map((i) => i.title)).toEqual(['FailedResult', 'KeptResult', 'LiveRun', 'Foo', 'Safari']);
  });

  it('keeps relative input order within the same section (stable)', () => {
    const a = makeItem({ type: 'run', object_id: 'run_a', title: 'A' });
    const b = makeItem({ type: 'run', object_id: 'run_b', title: 'B' });
    const c = makeItem({ type: 'run', object_id: 'run_c', title: 'C' });
    const out = sortBySectionOrder([b, a, c], [], [], []);
    expect(out.map((i) => i.title)).toEqual(['B', 'A', 'C']);
  });

  it('promotes a script def into Active when a matching run is live', () => {
    const defA = makeItem({ type: 'command', object_id: 'cmd_scripts_dyn_a', title: 'A' });
    const defB = makeItem({ type: 'command', object_id: 'cmd_scripts_dyn_b', title: 'B' });
    const idle = makeItem({ type: 'application', object_id: 'app_safari', title: 'Safari' });
    const active = [makeRun({ id: 'r1', subjectId: 'cmd_scripts_dyn_a', status: 'running' })];

    const out = sortBySectionOrder([defA, defB, idle], active, [], []);
    expect(out.map((i) => i.title)).toEqual(['A', 'B', 'Safari']);
  });

  it('after sort, the array order matches what buildSectionedView surfaces between headers — keyboard nav stays coherent', () => {
    const liveRun = makeItem({ type: 'run', object_id: 'run_live', title: 'LiveRun' });
    const keptResult = makeItem({ type: 'run-done', object_id: 'run_done', title: 'KeptResult' });
    const app = makeItem({ type: 'application', object_id: 'app_safari', title: 'Safari' });

    const sorted = sortBySectionOrder([app, liveRun, keptResult], [], [], []);
    const rows = buildSectionedView(sorted, [], [], []);
    const itemTitles = rows
      .filter((r) => r.kind === 'item')
      .map((r) => (r as { kind: 'item'; item: MappedSearchItem; originalIndex: number }).item.title);

    expect(itemTitles).toEqual(sorted.map((i) => i.title));
    // originalIndex of each item row reflects its position in the sorted array
    const itemRows = rows.filter((r) => r.kind === 'item') as {
      kind: 'item';
      item: MappedSearchItem;
      originalIndex: number;
    }[];
    itemRows.forEach((r, i) => expect(r.originalIndex).toBe(i));
  });
});
