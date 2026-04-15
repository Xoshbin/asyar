import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusBarServiceProxy } from './StatusBarServiceProxy';
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
  const proxy = new StatusBarServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('StatusBarServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registerItem → "statusBar:registerItem"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.registerItem({ id: 'i1' } as any);
    const call = mockInvoke.mock.calls.find(c => c[0] === 'statusBar:registerItem');
    expect(call).toBeDefined();
  });

  it('updateItem → "statusBar:updateItem"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.updateItem('i1', {} as any);
    const call = mockInvoke.mock.calls.find(c => c[0] === 'statusBar:updateItem');
    expect(call).toBeDefined();
  });

  it('unregisterItem → "statusBar:unregisterItem"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.unregisterItem('i1');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'statusBar:unregisterItem');
    expect(call).toBeDefined();
  });
});
