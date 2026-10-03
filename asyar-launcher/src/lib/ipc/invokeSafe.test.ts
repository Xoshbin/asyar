import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/log/logService', () => ({
  logService: { error: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { logService } from '../../services/log/logService';
import {
  IpcError,
  invokeSafe,
  invokeSafeVoid,
  setInvokeFailureReporter,
  type InvokeFailureReporter,
} from './invokeSafe';

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

  it('returns a successful non-null result', async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true });
    const r = await invokeSafe<{ ok: boolean }>('foo');
    expect(r).toEqual({ ok: true });
    expect(reporter.report).not.toHaveBeenCalled();
  });

  it('preserves a successful null result from Option<T>', async () => {
    vi.mocked(invoke).mockResolvedValue(null);

    await expect(invokeSafe<string | null>('foo')).resolves.toBeNull();
    expect(reporter.report).not.toHaveBeenCalled();
  });

  it('preserves a successful void result', async () => {
    vi.mocked(invoke).mockResolvedValue(null);

    await expect(invokeSafeVoid('foo')).resolves.toBe(true);
    expect(reporter.report).not.toHaveBeenCalled();
  });

  it('on Diagnostic-shaped rejection: logs, reports, and throws a typed error', async () => {
    const diagnostic = {
      source: 'rust',
      kind: 'permission_denied',
      severity: 'warning',
      retryable: false,
      developerDetail: 'rust detail',
    } as const;
    vi.mocked(invoke).mockRejectedValue(diagnostic);

    const rejection = invokeSafe('foo');

    await expect(rejection).rejects.toMatchObject({
      name: 'IpcError',
      command: 'foo',
      diagnostic,
      cause: diagnostic,
    });
    await expect(rejection).rejects.toBeInstanceOf(IpcError);
    expect(reporter.report).toHaveBeenCalledWith(diagnostic);
    expect(logService.error).toHaveBeenCalled();
  });

  it('normalizes a string rejection into a typed error', async () => {
    vi.mocked(invoke).mockRejectedValue('boom');

    const rejection = invokeSafe('foo');

    await expect(rejection).rejects.toMatchObject({
      name: 'IpcError',
      command: 'foo',
      diagnostic: {
        kind: 'invoke_unknown',
        severity: 'error',
        developerDetail: 'boom',
      },
    });
    const arg = reporter.report.mock.calls[0][0];
    expect(arg.kind).toBe('invoke_unknown');
    expect(arg.severity).toBe('error');
    expect(arg.developerDetail).toContain('boom');
  });

  it('normalizes an unknown object rejection without losing readable detail', async () => {
    vi.mocked(invoke).mockRejectedValue({ message: 'transport unavailable', code: 503 });

    await expect(invokeSafe('foo')).rejects.toMatchObject({
      diagnostic: {
        kind: 'invoke_unknown',
        developerDetail: 'transport unavailable',
      },
    });
  });

  it('silent: true skips report but still logs', async () => {
    vi.mocked(invoke).mockRejectedValue('boom');
    await expect(invokeSafe('foo', undefined, { silent: true })).rejects.toBeInstanceOf(IpcError);
    expect(reporter.report).not.toHaveBeenCalled();
    expect(logService.error).toHaveBeenCalled();
  });

  it('retry: registers callback and stamps retryActionId + retryable', async () => {
    vi.mocked(invoke).mockRejectedValue('boom');
    const retry = vi.fn().mockResolvedValue(undefined);
    await expect(invokeSafe('foo', undefined, { retry })).rejects.toBeInstanceOf(IpcError);
    const arg = reporter.report.mock.calls[0][0];
    expect(arg.retryActionId).toBe('retry-x');
    expect(arg.retryable).toBe(true);
  });

  it('without a registered reporter: still logs and throws the typed error', async () => {
    setInvokeFailureReporter(null);
    vi.mocked(invoke).mockRejectedValue('boom');
    await expect(invokeSafe('foo')).rejects.toBeInstanceOf(IpcError);
    expect(logService.error).toHaveBeenCalled();
    expect(reporter.report).not.toHaveBeenCalled();
  });
});
