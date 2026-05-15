import { describe, it, expect } from 'vitest';
import type { Run, RunKind, RunStatus } from 'asyar-sdk/contracts';
import {
  computeItemStatus,
  aggregateKindCounts,
  statusForRow,
  type RunSnapshot,
} from './itemStatusLogic';

function snap(over: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: 'r1',
    kind: 'shell-script' as RunKind,
    status: 'running' as RunStatus,
    subjectId: 'cmd_scripts_dyn_abc',
    startedAt: 1_700_000_000_000,
    endedAt: undefined,
    ...over,
  };
}

describe('computeItemStatus', () => {
  it('returns "active" when at least one matching run is running', () => {
    expect(computeItemStatus('cmd_scripts_dyn_abc', [snap()])).toBe('active');
  });

  it('returns "active" when a matching run is pending', () => {
    expect(computeItemStatus('cmd_scripts_dyn_abc', [snap({ status: 'pending' })])).toBe('active');
  });

  it('returns "done" when a matching run has succeeded', () => {
    // Succeeded shell-script runs are kept in the active snapshot for a brief
    // cooldown window (e.g., 3s) so the UI can show positive feedback (green dot).
    expect(computeItemStatus('cmd_scripts_dyn_abc', [snap({ status: 'succeeded' })])).toBe('done');
  });

  it('returns "failed" when a matching unacknowledged failed run exists', () => {
    const failed = [snap({ status: 'failed', subjectId: 'cmd_scripts_dyn_abc' })];
    expect(computeItemStatus('cmd_scripts_dyn_abc', [], failed)).toBe('failed');
  });

  it('ignores runs with a non-matching subjectId', () => {
    expect(computeItemStatus('cmd_scripts_dyn_abc', [snap({ subjectId: 'cmd_scripts_dyn_other' })])).toBeNull();
  });

  it('returns null when subjectId is undefined or empty', () => {
    expect(computeItemStatus(undefined, [])).toBeNull();
    expect(computeItemStatus('', [])).toBeNull();
  });

  it('ignores runs whose own subjectId is undefined', () => {
    expect(computeItemStatus(undefined, [snap({ subjectId: undefined })])).toBeNull();
  });
});

describe('aggregateKindCounts', () => {
  it('counts active scripts and agents from the active snapshot', () => {
    const active: RunSnapshot[] = [
      snap({ id: '1', kind: 'shell-script', subjectId: 'cmd_scripts_dyn_a' }),
      snap({ id: '2', kind: 'shell-script', subjectId: 'cmd_scripts_dyn_b' }),
      snap({ id: '3', kind: 'agent',         subjectId: 'cmd_agents_dyn_a1' }),
    ];
    const result = aggregateKindCounts(active, []);
    expect(result.scripts.active).toBe(2);
    expect(result.agents.active).toBe(1);
  });

  it('counts succeeded scripts toward scripts.done during cooldown', () => {
    // When a succeeded script run is kept in active snapshot during its 3s cooldown,
    // it contributes to the HUD Done count.
    const result = aggregateKindCounts(
      [snap({ kind: 'shell-script', status: 'succeeded', subjectId: 'cmd_scripts_dyn_a' })],
      [],
    );
    expect(result.scripts.done).toBe(1);
  });

  it('agents.done == keptAgents.length (no time window)', () => {
    // keptAgents is the user-dismissable slice of succeeded agent runs.
    // Service-layer dedup ensures one entry per agent, so .length is the
    // per-agent kept-thread count.
    const kept: RunSnapshot[] = [
      snap({ id: 'k1', kind: 'agent', status: 'succeeded', subjectId: 'cmd_agents_dyn_a1', endedAt: 100 }),
      snap({ id: 'k2', kind: 'agent', status: 'succeeded', subjectId: 'cmd_agents_dyn_a2', endedAt: 200 }),
    ];
    const result = aggregateKindCounts([], kept);
    expect(result.agents.done).toBe(2);
  });

  it('combines active running threads with kept-done threads', () => {
    const active: RunSnapshot[] = [
      snap({ id: 'r1', kind: 'agent', subjectId: 'cmd_agents_dyn_a1' }),
    ];
    const kept: RunSnapshot[] = [
      snap({ id: 'k1', kind: 'agent', status: 'succeeded', subjectId: 'cmd_agents_dyn_a2', endedAt: 1 }),
    ];
    const result = aggregateKindCounts(active, kept);
    expect(result.agents).toEqual({ active: 1, done: 1 });
  });

  it('returns zeroes when there are no runs', () => {
    expect(aggregateKindCounts([], [])).toEqual({
      scripts: { active: 0, done: 0 },
      agents:  { active: 0, done: 0 },
    });
  });

  it('counts anonymous Tier 2 runs (no subjectId) by kind', () => {
    // sdk-playground and similar Tier 2 extensions dispatch shell-scripts
    // without a subjectId (they have no launcher item to attribute to).
    // The HUD is a machine-level aggregate, so it should match what the
    // SectionedResultsList shows in default mode — and that includes
    // anonymous Tier 2 runs as `run` rows in the Scripts section.
    const active: RunSnapshot[] = [
      snap({ id: 'a1', kind: 'shell-script', subjectId: undefined }),
      snap({ id: 'a2', kind: 'agent',         subjectId: undefined }),
    ];
    expect(aggregateKindCounts(active, [])).toEqual({
      scripts: { active: 1, done: 0 },
      agents:  { active: 1, done: 0 },
    });
  });

  it('ignores ai-chat and custom kinds in the active count', () => {
    const active: RunSnapshot[] = [
      snap({ id: '1', kind: 'ai-chat' as RunKind, subjectId: 'cmd_x' }),
      snap({ id: '2', kind: 'custom' as RunKind,  subjectId: 'cmd_y' }),
    ];
    expect(aggregateKindCounts(active, [])).toEqual({
      scripts: { active: 0, done: 0 },
      agents:  { active: 0, done: 0 },
    });
  });
});

describe('statusForRow', () => {
  it('returns "active" for any run row (type === "run")', () => {
    expect(statusForRow({ type: 'run', object_id: 'run_xyz' }, [])).toBe('active');
  });

  it('returns "done" for a kept agent row (type === "run-done")', () => {
    // Injected by searchResultMapper from runService.keptAgents.
    expect(statusForRow({ type: 'run-done', object_id: 'run_xyz' }, [])).toBe('done');
  });

  it('returns "failed" for run-failed rows (gives a red dot)', () => {
    expect(statusForRow({ type: 'run-failed', object_id: 'run_xyz' }, [])).toBe('failed');
  });

  it('returns "active" for a script row when a matching live run exists', () => {
    const active = [snap({ subjectId: 'cmd_scripts_dyn_abc' })];
    expect(statusForRow(
      { type: 'command', object_id: 'cmd_scripts_dyn_abc' },
      active,
    )).toBe('active');
  });

  it('returns null for a script row when its run has succeeded and cooldown expired', () => {
    // After the 3s cooldown, the run vanishes from active, so the dot turns off.
    expect(statusForRow(
      { type: 'command', object_id: 'cmd_scripts_dyn_abc' },
      [],  // run has already vanished from active
    )).toBeNull();
  });

  it('returns "done" for a script row during the succeeded run cooldown', () => {
    const active = [snap({ status: 'succeeded', subjectId: 'cmd_scripts_dyn_abc' })];
    expect(statusForRow(
      { type: 'command', object_id: 'cmd_scripts_dyn_abc' },
      active,
    )).toBe('done');
  });

  it('returns "failed" for a script row when a matching unacknowledged failed run exists', () => {
    const failed = [snap({ status: 'failed', subjectId: 'cmd_scripts_dyn_abc' })];
    expect(statusForRow(
      { type: 'command', object_id: 'cmd_scripts_dyn_abc' },
      [],
      failed,
    )).toBe('failed');
  });

  it('returns null for agent definition rows even when a matching run exists', () => {
    // The kept-thread row carries the signal in the Agents section. Lighting
    // up the agent definition in Commands too would double-signal.
    const active = [snap({ kind: 'agent', subjectId: 'cmd_agents_dyn_a1' })];
    expect(statusForRow(
      { type: 'command', object_id: 'cmd_agents_dyn_a1' },
      active,
    )).toBeNull();
  });

  it('returns null for app rows', () => {
    expect(statusForRow(
      { type: 'application', object_id: 'app_safari' },
      [],
    )).toBeNull();
  });

  it('returns null for non-dynamic command rows', () => {
    expect(statusForRow(
      { type: 'command', object_id: 'cmd_clipboard_history' },
      [],
    )).toBeNull();
  });
});

// Sanity: the RunSnapshot type is a structural subset of Run from the SDK,
// so any reactive Run array can be passed straight in without mapping.
describe('RunSnapshot ↔ Run structural compatibility', () => {
  it('accepts a full SDK Run as a RunSnapshot', () => {
    const run: Run = {
      id: 'r1',
      kind: 'shell-script',
      label: 'Hosts Update',
      status: 'running',
      startedAt: 1_700_000_000_000,
      cancellable: false,
      subjectId: 'cmd_scripts_dyn_abc',
    };
    const sn: RunSnapshot = run;
    expect(sn.subjectId).toBe('cmd_scripts_dyn_abc');
  });
});
