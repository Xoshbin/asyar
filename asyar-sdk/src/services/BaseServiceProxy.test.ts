import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseServiceProxy } from './BaseServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';
import type { WireCommand } from '../ipc/namespaces';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), off: vi.fn() },
}));

// Minimal concrete proxy exposing the protected invoke() for testing. Returned
// handles use this.invoke() so extensionId is injected structurally — no need
// to capture the (patched) broker, which is the footgun this replaces.
class TestProxy extends BaseServiceProxy {
  call(command: WireCommand, payload?: Record<string, unknown>, timeoutMs?: number) {
    return this.invoke(command, payload, timeoutMs);
  }
}

describe('BaseServiceProxy.invoke', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stamps the proxy extensionId as the third arg, without capturing the broker', () => {
    const proxy = new TestProxy();
    proxy.setExtensionId('ext.test');
    proxy.call('runs:start', { id: 'r1' });
    expect(messageBroker.invoke).toHaveBeenCalledWith(
      'runs:start',
      { id: 'r1' },
      'ext.test',
      undefined,
    );
  });

  it('forwards a per-call timeout to the broker', () => {
    const proxy = new TestProxy();
    proxy.setExtensionId('ext.test');
    proxy.call('feedback:confirmAlert', { options: {} }, 5000);
    expect(messageBroker.invoke).toHaveBeenCalledWith(
      'feedback:confirmAlert',
      { options: {} },
      'ext.test',
      5000,
    );
  });
});
