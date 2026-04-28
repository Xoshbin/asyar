import { describe, expect, it } from 'vitest';
import type { Diagnostic, IDiagnosticsService, Severity } from './diagnostics';

describe('Diagnostic contract', () => {
  it('accepts a minimal extension report', () => {
    const d: Omit<Diagnostic, 'source' | 'extensionId'> = {
      kind: 'extension_proxy_error',
      severity: 'warning',
      retryable: false,
    };
    const sev: Severity = d.severity;
    expect(sev).toBe('warning');
  });

  it('supports context and retryActionId', () => {
    const d: Omit<Diagnostic, 'source' | 'extensionId'> = {
      kind: 'rpc_timeout',
      severity: 'warning',
      retryable: true,
      context: { method: 'storage:get' },
      retryActionId: 'retry-1',
      developerDetail: 'timeout 5s',
    };
    expect(d.context?.method).toBe('storage:get');
  });

  it('IDiagnosticsService.report is async', () => {
    const svc: IDiagnosticsService = { report: async () => undefined };
    expect(svc.report({ kind: 'manual', severity: 'info', retryable: false })).toBeInstanceOf(Promise);
  });
});
