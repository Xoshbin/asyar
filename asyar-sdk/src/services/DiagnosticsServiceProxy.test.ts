import { describe, expect, it, vi } from 'vitest';
import { DiagnosticsServiceProxy } from './DiagnosticsServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('DiagnosticsServiceProxy', () => {
  it('invokes diagnostics:report with the payload wrapped in a { d } envelope', async () => {
    const spy = vi.spyOn(messageBroker, 'invoke').mockResolvedValue(undefined);
    const proxy = new DiagnosticsServiceProxy();
    await proxy.report({
      kind: 'manual',
      severity: 'warning',
      retryable: false,
      context: { foo: 'bar' },
    });
    expect(spy).toHaveBeenCalledWith('diagnostics:report', {
      d: {
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { foo: 'bar' },
      },
    });
    spy.mockRestore();
  });

  it('does not pass source or extensionId — host injects them', async () => {
    const spy = vi.spyOn(messageBroker, 'invoke').mockResolvedValue(undefined);
    const proxy = new DiagnosticsServiceProxy();
    await proxy.report({ kind: 'manual', severity: 'info', retryable: false });
    const [, payload] = spy.mock.calls[0];
    const inner = (payload as { d: Record<string, unknown> }).d;
    expect(inner).not.toHaveProperty('source');
    expect(inner).not.toHaveProperty('extensionId');
    spy.mockRestore();
  });
});
