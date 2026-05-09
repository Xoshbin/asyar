import { describe, it, expect } from 'vitest';
import { formatRunSubtitle, combineActiveAndRecent } from './runViewLogic';
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

// ── formatRunSubtitle ─────────────────────────────────────────────────────────

describe('formatRunSubtitle', () => {
  it('formatRunSubtitle_running_shows_status_and_elapsed', () => {
    const now = Date.now();
    const run = makeRun({ status: 'running', startedAt: now - 12_000 });
    const result = formatRunSubtitle(run);
    expect(result).toContain('Running');
    expect(result).toContain('12s');
  });

  it('formatRunSubtitle_succeeded_shows_succeeded_and_total_duration', () => {
    const startedAt = Date.now() - 10_000;
    const endedAt = startedAt + 5_000;
    const run = makeRun({ status: 'succeeded', startedAt, endedAt });
    const result = formatRunSubtitle(run);
    expect(result).toContain('Succeeded');
    expect(result).toContain('5s');
  });

  it('formatRunSubtitle_failed_shows_error_message_when_short', () => {
    const run = makeRun({ status: 'failed', errorMessage: 'exit code 1' });
    const result = formatRunSubtitle(run);
    expect(result).toContain('Failed');
    expect(result).toContain('exit code 1');
  });

  it('formatRunSubtitle_failed_truncates_long_error_message', () => {
    const longMessage = 'a'.repeat(100);
    const run = makeRun({ status: 'failed', errorMessage: longMessage });
    const result = formatRunSubtitle(run);
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it('formatRunSubtitle_cancelled_shows_cancelled', () => {
    const run = makeRun({ status: 'cancelled' });
    const result = formatRunSubtitle(run);
    expect(result).toContain('Cancelled');
  });
});

// ── combineActiveAndRecent ────────────────────────────────────────────────────

describe('combineActiveAndRecent', () => {
  it('combineActiveAndRecent_active_first_then_recent', () => {
    const a1 = makeRun({ id: 'a1', status: 'running' });
    const a2 = makeRun({ id: 'a2', status: 'running' });
    const r1 = makeRun({ id: 'r1', status: 'succeeded' });
    const r2 = makeRun({ id: 'r2', status: 'failed' });
    const r3 = makeRun({ id: 'r3', status: 'cancelled' });

    const result = combineActiveAndRecent([a1, a2], [r1, r2, r3]);

    expect(result).toEqual([a1, a2, r1, r2, r3]);
  });

  it('combineActiveAndRecent_dedup_by_id_active_wins', () => {
    const active = makeRun({ id: 'x', status: 'running', label: 'Active X' });
    const recentX = makeRun({ id: 'x', status: 'succeeded', label: 'Recent X' });
    const recentY = makeRun({ id: 'y', status: 'failed', label: 'Recent Y' });

    const result = combineActiveAndRecent([active], [recentX, recentY]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(active);
    expect(result[1]).toEqual(recentY);
    expect(result.find(r => r.label === 'Recent X')).toBeUndefined();
  });

  it('combineActiveAndRecent_handles_empty_inputs', () => {
    const a1 = makeRun({ id: 'a1', status: 'running' });
    const r1 = makeRun({ id: 'r1', status: 'succeeded' });

    expect(combineActiveAndRecent([], [])).toEqual([]);
    expect(combineActiveAndRecent([a1], [])).toEqual([a1]);
    expect(combineActiveAndRecent([], [r1])).toEqual([r1]);
  });
});
