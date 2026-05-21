import { describe, it, expect } from 'vitest';
import type { Run, RunKind, RunStatus } from 'asyar-sdk/contracts';
import {
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

describe('aggregateKindCounts', () => {
  it('sums active scripts and agents into the active count', () => {
    const active: RunSnapshot[] = [
      snap({ id: '1', kind: 'shell-script', subjectId: 'cmd_scripts_dyn_a' }),
      snap({ id: '2', kind: 'shell-script', subjectId: 'cmd_scripts_dyn_b' }),
      snap({ id: '3', kind: 'agent',         subjectId: 'cmd_agents_dyn_a1' }),
    ];
    expect(aggregateKindCounts(active, [])).toEqual({ active: 3, done: 0 });
  });

  it('done includes kept script results', () => {
    const scriptResults: RunSnapshot[] = [
      snap({ id: 'k1', kind: 'shell-script', status: 'succeeded', subjectId: 'cmd_scripts_dyn_a', endedAt: 1 }),
      snap({ id: 'k2', kind: 'shell-script', status: 'succeeded', subjectId: 'cmd_scripts_dyn_b', endedAt: 2 }),
    ];
    expect(aggregateKindCounts([], [], scriptResults)).toEqual({ active: 0, done: 2 });
  });

  it('done includes kept agent threads', () => {
    // keptAgents is the user-dismissable slice of succeeded agent runs.
    // Service-layer dedup ensures one entry per agent.
    const kept: RunSnapshot[] = [
      snap({ id: 'k1', kind: 'agent', status: 'succeeded', subjectId: 'cmd_agents_dyn_a1', endedAt: 100 }),
      snap({ id: 'k2', kind: 'agent', status: 'succeeded', subjectId: 'cmd_agents_dyn_a2', endedAt: 200 }),
    ];
    expect(aggregateKindCounts([], kept)).toEqual({ active: 0, done: 2 });
  });

  it('done sums kept scripts and kept agents together', () => {
    const scriptResults: RunSnapshot[] = [
      snap({ id: 'k1', kind: 'shell-script', status: 'succeeded', subjectId: 'cmd_scripts_dyn_a', endedAt: 1 }),
    ];
    const kept: RunSnapshot[] = [
      snap({ id: 'k2', kind: 'agent', status: 'succeeded', subjectId: 'cmd_agents_dyn_a1', endedAt: 2 }),
    ];
    expect(aggregateKindCounts([], kept, scriptResults)).toEqual({ active: 0, done: 2 });
  });

  it('combines a live agent with a kept agent into active + done', () => {
    const active: RunSnapshot[] = [
      snap({ id: 'r1', kind: 'agent', subjectId: 'cmd_agents_dyn_a1' }),
    ];
    const kept: RunSnapshot[] = [
      snap({ id: 'k1', kind: 'agent', status: 'succeeded', subjectId: 'cmd_agents_dyn_a2', endedAt: 1 }),
    ];
    expect(aggregateKindCounts(active, kept)).toEqual({ active: 1, done: 1 });
  });

  it('returns zeroes when there are no runs', () => {
    expect(aggregateKindCounts([], [])).toEqual({ active: 0, done: 0 });
  });

  it('counts anonymous Tier 2 runs (no subjectId)', () => {
    // sdk-playground and similar Tier 2 extensions dispatch runs without a
    // subjectId (they have no launcher item to attribute to). The HUD is a
    // machine-level aggregate, so anonymous runs count too.
    const active: RunSnapshot[] = [
      snap({ id: 'a1', kind: 'shell-script', subjectId: undefined }),
      snap({ id: 'a2', kind: 'agent',         subjectId: undefined }),
    ];
    expect(aggregateKindCounts(active, [])).toEqual({ active: 2, done: 0 });
  });

  it('ignores ai-chat and custom kinds in the active count', () => {
    const active: RunSnapshot[] = [
      snap({ id: '1', kind: 'ai-chat' as RunKind, subjectId: 'cmd_x' }),
      snap({ id: '2', kind: 'custom' as RunKind,  subjectId: 'cmd_y' }),
    ];
    expect(aggregateKindCounts(active, [])).toEqual({ active: 0, done: 0 });
  });
});

describe('statusForRow', () => {
  it('returns "active" for any run row (type === "run")', () => {
    expect(statusForRow({ type: 'run', object_id: 'run_xyz' }, [])).toBe('active');
  });

  it('returns "done" for a kept-done row (type === "run-done")', () => {
    expect(statusForRow({ type: 'run-done', object_id: 'run_xyz' }, [])).toBe('done');
  });

  it('returns "failed" for run-failed rows', () => {
    expect(statusForRow({ type: 'run-failed', object_id: 'run_xyz' }, [])).toBe('failed');
  });

  it('lights up a script def row as "active" when a matching run is live', () => {
    const active = [snap({ id: 'r-live', subjectId: 'cmd_scripts_dyn_abc', status: 'running' })];
    expect(statusForRow({ type: 'command', object_id: 'cmd_scripts_dyn_abc' }, active, [], [])).toBe('active');
  });

  it('lights up a script def row as "done" when it has a kept-success result', () => {
    const succeeded = [snap({ id: 'r-done', subjectId: 'cmd_scripts_dyn_abc', status: 'succeeded', endedAt: 1 })];
    expect(statusForRow({ type: 'command', object_id: 'cmd_scripts_dyn_abc' }, [], [], succeeded)).toBe('done');
  });

  it('lights up a script def row as "failed" when it has an unack failure', () => {
    const failed = [snap({ id: 'r-fail', subjectId: 'cmd_scripts_dyn_abc', status: 'failed', endedAt: 1 })];
    expect(statusForRow({ type: 'command', object_id: 'cmd_scripts_dyn_abc' }, [], failed, [])).toBe('failed');
  });

  it('returns null for a script def row with no associated run', () => {
    expect(statusForRow({ type: 'command', object_id: 'cmd_scripts_dyn_abc' }, [], [], [])).toBeNull();
  });

  it('returns null for agent definition rows even with a matching run — only scripts climb', () => {
    const active = [snap({ id: 'r-a', kind: 'agent', subjectId: 'cmd_agents_dyn_a1', status: 'running' })];
    expect(statusForRow({ type: 'command', object_id: 'cmd_agents_dyn_a1' }, active, [], [])).toBeNull();
  });

  it('returns null for app rows', () => {
    expect(statusForRow({ type: 'application', object_id: 'app_safari' }, [])).toBeNull();
  });

  it('returns null for non-dynamic command rows', () => {
    expect(statusForRow({ type: 'command', object_id: 'cmd_clipboard_history' }, [])).toBeNull();
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
