import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { diagnosticsService } from './diagnosticsService.svelte';
import type { Diagnostic } from 'asyar-sdk/contracts';

const make = (over: Partial<Diagnostic> = {}): Diagnostic => ({
  source: 'rust',
  kind: 'unknown',
  severity: 'error',
  retryable: false,
  ...over,
});

describe('diagnosticsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    diagnosticsService.reset();
  });
  afterEach(() => vi.useRealTimers());

  it('reports a payload, current is set', () => {
    diagnosticsService.report(make({ kind: 'permission_denied', severity: 'warning' }));
    expect(diagnosticsService.current?.kind).toBe('permission_denied');
  });

  it('info auto-clears after 3s', () => {
    diagnosticsService.report(make({ kind: 'manual', severity: 'info' }));
    expect(diagnosticsService.current).not.toBeNull();
    vi.advanceTimersByTime(3001);
    expect(diagnosticsService.current).toBeNull();
  });

  it('warning auto-clears after 8s', () => {
    diagnosticsService.report(make({ kind: 'permission_denied', severity: 'warning' }));
    vi.advanceTimersByTime(7000);
    expect(diagnosticsService.current).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(diagnosticsService.current).toBeNull();
  });

  it('error is sticky (does not auto-clear)', () => {
    diagnosticsService.report(make({ severity: 'error' }));
    vi.advanceTimersByTime(60_000);
    expect(diagnosticsService.current).not.toBeNull();
  });

  it('dismiss clears current', () => {
    diagnosticsService.report(make({ severity: 'error' }));
    diagnosticsService.dismiss();
    expect(diagnosticsService.current).toBeNull();
  });

  it('registerRetry returns an id and triggerRetry runs the fn', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const id = diagnosticsService.registerRetry(fn);
    await diagnosticsService.triggerRetry(id);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('coalesces identical info kind within 1s', () => {
    diagnosticsService.report(make({ kind: 'manual', severity: 'info' }));
    vi.advanceTimersByTime(100);
    diagnosticsService.report(make({ kind: 'manual', severity: 'info' }));
    expect(diagnosticsService.current?.kind).toBe('manual');
  });
});
