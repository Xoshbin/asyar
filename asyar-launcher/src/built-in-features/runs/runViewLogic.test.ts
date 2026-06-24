import { describe, it, expect } from 'vitest';
import { formatRunSubtitle } from './runViewLogic';
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
