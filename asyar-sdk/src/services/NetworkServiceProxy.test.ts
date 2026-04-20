import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkServiceProxy } from './NetworkServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue({ status: 200, body: 'ok' });
  Object.assign(messageBroker, {
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  });
  const proxy = new NetworkServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('NetworkServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetch → "network:fetch" with url and default options', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.fetch('https://example.com');
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'network:fetch',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ url: 'https://example.com', options: {} });
  });

  it('fetch → "network:fetch" with custom options', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const opts = { method: 'POST' as const, body: '{}', timeout: 5000 };
    await proxy.fetch('https://example.com/api', opts);
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'network:fetch',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({
      url: 'https://example.com/api',
      options: opts,
    });
  });
});
