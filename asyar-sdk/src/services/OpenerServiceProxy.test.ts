import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenerServiceProxy } from './OpenerServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

function makeProxy() {
  const mockInvoke = vi.fn();
  Object.assign(messageBroker, {
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  });
  const proxy = new OpenerServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('OpenerServiceProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('openUrl → "opener:open" with { url }', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(undefined);

    await proxy.openUrl('https://example.com');

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'opener:open');
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual({ url: 'https://example.com' });
  });

  it('propagates invocation errors/rejections from the message broker', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockRejectedValue(new Error('Permission denied: shell:open-url required'));

    await expect(proxy.openUrl('steam://run/3932890')).rejects.toThrow(
      'Permission denied: shell:open-url required',
    );
  });
});
