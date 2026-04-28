import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: {
    report: vi.fn(),
    registerRetry: vi.fn(() => 'retry-x'),
  },
}));
vi.mock('../../services/log/logService', () => ({
  logService: { error: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { logService } from '../../services/log/logService';
import { invokeSafe } from './invokeSafe';

describe('invokeSafe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes through a successful result', async () => {
    (invoke as any).mockResolvedValue({ ok: true });
    const r = await invokeSafe<{ ok: boolean }>('foo');
    expect(r).toEqual({ ok: true });
    expect(diagnosticsService.report).not.toHaveBeenCalled();
  });

  it('on Diagnostic-shaped rejection: logs + reports + returns null', async () => {
    (invoke as any).mockRejectedValue({
      source: 'rust',
      kind: 'permission_denied',
      severity: 'warning',
      retryable: false,
      developerDetail: 'rust detail',
    });
    const r = await invokeSafe('foo');
    expect(r).toBeNull();
    expect(diagnosticsService.report).toHaveBeenCalled();
    expect(logService.error).toHaveBeenCalled();
  });

  it('on string rejection: wraps as kind=invoke_unknown', async () => {
    (invoke as any).mockRejectedValue('boom');
    await invokeSafe('foo');
    const arg = (diagnosticsService.report as any).mock.calls[0][0];
    expect(arg.kind).toBe('invoke_unknown');
    expect(arg.severity).toBe('error');
    expect(arg.developerDetail).toContain('boom');
  });

  it('silent: true skips report but still logs', async () => {
    (invoke as any).mockRejectedValue('boom');
    await invokeSafe('foo', undefined, { silent: true });
    expect(diagnosticsService.report).not.toHaveBeenCalled();
    expect(logService.error).toHaveBeenCalled();
  });

  it('retry: registers callback and stamps retryActionId + retryable', async () => {
    (invoke as any).mockRejectedValue('boom');
    const retry = vi.fn().mockResolvedValue(undefined);
    await invokeSafe('foo', undefined, { retry });
    const arg = (diagnosticsService.report as any).mock.calls[0][0];
    expect(arg.retryActionId).toBe('retry-x');
    expect(arg.retryable).toBe(true);
  });
});
