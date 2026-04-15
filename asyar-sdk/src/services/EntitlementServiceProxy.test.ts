import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntitlementServiceProxy } from './EntitlementServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(() => ({ invoke: vi.fn(), on: vi.fn(), off: vi.fn() })),
  },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  vi.mocked(MessageBroker.getInstance).mockReturnValue({
    invoke: mockInvoke, on: vi.fn(), off: vi.fn(),
  } as any);
  const proxy = new EntitlementServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('EntitlementServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('check → "entitlements:check"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    await proxy.check('pro');
    expect(mockInvoke.mock.calls[0][0]).toBe('entitlements:check');
    expect(mockInvoke.mock.calls[0][1]).toMatchObject({ entitlement: 'pro' });
  });
  it('getAll → "entitlements:getAll"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue([]);
    await proxy.getAll();
    expect(mockInvoke.mock.calls[0][0]).toBe('entitlements:getAll');
  });
});
