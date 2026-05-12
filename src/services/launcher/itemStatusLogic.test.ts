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

  it('does NOT return "done" — succeeded scripts auto-remove', () => {
    // Even if a succeeded run somehow appears in the active snapshot, the
    // function shouldn't return 'done'. The done window was deliberately
    // dropped per the lifecycle policy.
    expect(computeItemStatus('cmd_scripts_dyn_abc', [snap({ status: 'succeeded' })])).toBeNull();
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

  it('scripts.done is always 0 — succeeded scripts auto-remove', () => {
    // Even if somehow a succeeded script run sneaks into the snapshots,
    // the HUD must not show "Done" for scripts under the user-locked
    // policy (only failed scripts persist via unacknowledgedFailures,
    // and those are not surfaced through this aggregate).
    const result = aggregateKindCounts(
      [snap({ kind: 'shell-script', status: 'succeeded', subjectId: 'cmd_scripts_dyn_a' })],
      [],
    );
    expect(result.scripts.done).toBe(0);
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

  it('ignores active runs without a subjectId', () => {
    const active = [snap({ subjectId: undefined })];
    expect(aggregateKindCounts(active, []).scripts.active).toBe(0);
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

  it('returns null for run-failed rows (subtitle handles failure)', () => {
    expect(statusForRow({ type: 'run-failed', object_id: 'run_xyz' }, [])).toBeNull();
  });

  it('returns "active" for a script row when a matching live run exists', () => {
    const active = [snap({ subjectId: 'cmd_scripts_dyn_abc' })];
    expect(statusForRow(
      { type: 'command', object_id: 'cmd_scripts_dyn_abc' },
      active,
    )).toBe('active');
  });

  it('returns null for a script row when its run has succeeded', () => {
    // Succeeded scripts auto-remove from the launcher — including the
    // dot on the definition row. No green-dot persistence.
    expect(statusForRow(
      { type: 'command', object_id: 'cmd_scripts_dyn_abc' },
      [],  // run has already vanished from active
    )).toBeNull();
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
