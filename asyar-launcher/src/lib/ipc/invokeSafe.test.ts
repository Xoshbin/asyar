import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/log/logService', () => ({
  logService: { error: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { logService } from '../../services/log/logService';
import { invokeSafe, setInvokeFailureReporter, type InvokeFailureReporter } from './invokeSafe';

// The transport reports failures to an injected sink, not the feedback store.
const reporter = {
  report: vi.fn(),
  registerRetry: vi.fn(() => 'retry-x'),
} satisfies InvokeFailureReporter;

describe('invokeSafe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInvokeFailureReporter(reporter);
  });

  it('passes through a successful result', async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true });
    const r = await invokeSafe<{ ok: boolean }>('foo');
    expect(r).toEqual({ ok: true });
    expect(reporter.report).not.toHaveBeenCalled();
  });

  it('on Diagnostic-shaped rejection: logs + reports + returns null', async () => {
    vi.mocked(invoke).mockRejectedValue({
      source: 'rust',
      kind: 'permission_denied',
      severity: 'warning',
      retryable: false,
      developerDetail: 'rust detail',
    });
    const r = await invokeSafe('foo');
    expect(r).toBeNull();
    expect(reporter.report).toHaveBeenCalled();
    expect(logService.error).toHaveBeenCalled();
  });

  it('on string rejection: wraps as kind=invoke_unknown', async () => {
    vi.mocked(invoke).mockRejectedValue('boom');
    await invokeSafe('foo');
    const arg = reporter.report.mock.calls[0][0];
    expect(arg.kind).toBe('invoke_unknown');
    expect(arg.severity).toBe('error');
    expect(arg.developerDetail).toContain('boom');
  });

  it('silent: true skips report but still logs', async () => {
    vi.mocked(invoke).mockRejectedValue('boom');
    await invokeSafe('foo', undefined, { silent: true });
    expect(reporter.report).not.toHaveBeenCalled();
    expect(logService.error).toHaveBeenCalled();
  });

  it('retry: registers callback and stamps retryActionId + retryable', async () => {
    vi.mocked(invoke).mockRejectedValue('boom');
    const retry = vi.fn().mockResolvedValue(undefined);
    await invokeSafe('foo', undefined, { retry });
    const arg = reporter.report.mock.calls[0][0];
    expect(arg.retryActionId).toBe('retry-x');
    expect(arg.retryable).toBe(true);
  });

  it('without a registered reporter: still logs and returns null, no throw', async () => {
    setInvokeFailureReporter(null);
    vi.mocked(invoke).mockRejectedValue('boom');
    const r = await invokeSafe('foo');
    expect(r).toBeNull();
    expect(logService.error).toHaveBeenCalled();
    expect(reporter.report).not.toHaveBeenCalled();
  });
});
