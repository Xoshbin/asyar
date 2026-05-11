import { describe, it, expect } from 'vitest';
import {
  groupRunsByKind,
  formatElapsed,
  statusIconName,
  type RunGroup,
} from './runningSectionLogic';
import type { Run } from 'asyar-sdk/contracts';

const makeRun = (over: Partial<Run> = {}): Run => ({
  id: 'r1',
  kind: 'shell-script',
  label: 'My Script',
  status: 'running',
  startedAt: Date.now(),
  cancellable: false,
  ...over,
});

// ── groupRunsByKind ───────────────────────────────────────────────────────────

describe('groupRunsByKind', () => {
  it('groups_shell_script_runs_under_scripts', () => {
    const run = makeRun({ id: 'r1', kind: 'shell-script' });
    const result = groupRunsByKind([run]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Scripts');
    expect(result[0].runs).toEqual([run]);
  });

  it('groups_agent_under_agents', () => {
    const agent = makeRun({ id: 'r1', kind: 'agent' });
    const result = groupRunsByKind([agent]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Agents');
    expect(result[0].runs).toEqual([agent]);
  });

  it('groups_custom_under_other', () => {
    const run = makeRun({ id: 'r1', kind: 'custom' });
    const result = groupRunsByKind([run]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Other');
    expect(result[0].runs).toEqual([run]);
  });

  it('omits_empty_groups', () => {
    const run = makeRun({ id: 'r1', kind: 'shell-script' });
    const result = groupRunsByKind([run]);
    const titles = result.map((g: RunGroup) => g.title);
    expect(titles).toContain('Scripts');
    expect(titles).not.toContain('Agents');
    expect(titles).not.toContain('Other');
  });

  it('output_order_is_scripts_then_agents_then_other', () => {
    const script = makeRun({ id: 'r1', kind: 'shell-script' });
    const agent = makeRun({ id: 'r2', kind: 'agent' });
    const custom = makeRun({ id: 'r3', kind: 'custom' });
    const result = groupRunsByKind([custom, agent, script]);
    expect(result.map((g: RunGroup) => g.title)).toEqual(['Scripts', 'Agents', 'Other']);
  });

  it('preserves_within_group_order', () => {
    const r1 = makeRun({ id: 'r1', kind: 'shell-script', label: 'first' });
    const r2 = makeRun({ id: 'r2', kind: 'shell-script', label: 'second' });
    const r3 = makeRun({ id: 'r3', kind: 'shell-script', label: 'third' });
    const result = groupRunsByKind([r1, r2, r3]);
    expect(result).toHaveLength(1);
    expect(result[0].runs).toEqual([r1, r2, r3]);
  });

  it('empty_input_returns_empty_array', () => {
    expect(groupRunsByKind([])).toEqual([]);
  });
});

// ── formatElapsed ─────────────────────────────────────────────────────────────

describe('formatElapsed', () => {
  it('formats_under_60s_as_seconds', () => {
    expect(formatElapsed(12000)).toBe('12s');
    expect(formatElapsed(0)).toBe('0s');
  });

  it('formats_under_3600s_as_minutes', () => {
    expect(formatElapsed(60000)).toBe('1m');
    expect(formatElapsed(120000)).toBe('2m');
    expect(formatElapsed(59000)).toBe('59s');
  });

  it('formats_3600s_or_more_as_hours', () => {
    expect(formatElapsed(3600000)).toBe('1h');
    expect(formatElapsed(7200000)).toBe('2h');
    expect(formatElapsed(3599000)).toBe('59m');
  });
});

// ── statusIconName ────────────────────────────────────────────────────────────

describe('statusIconName', () => {
  it('status_running_returns_running_icon', () => {
    const name = statusIconName('running');
    expect(name).toBeTruthy();
    expect(name.length).toBeGreaterThan(0);
  });

  it('status_succeeded_failed_cancelled_return_distinct_icons', () => {
    const succeeded = statusIconName('succeeded');
    const failed = statusIconName('failed');
    const cancelled = statusIconName('cancelled');
    expect(succeeded).toBeTruthy();
    expect(failed).toBeTruthy();
    expect(cancelled).toBeTruthy();
    expect(succeeded).not.toBe(failed);
    expect(succeeded).not.toBe(cancelled);
    expect(failed).not.toBe(cancelled);
  });
});
