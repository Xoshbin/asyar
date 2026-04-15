import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationServiceProxy } from './NotificationServiceProxy';
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
  const proxy = new NotificationServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('NotificationServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('notify → "notifications:notify"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.notify({ title: 't', body: 'b' });
    expect(mockInvoke.mock.calls[0][0]).toBe('notifications:notify');
  });
  it('checkPermission → "notifications:checkPermission"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.checkPermission();
    expect(mockInvoke.mock.calls[0][0]).toBe('notifications:checkPermission');
  });
  it('requestPermission → "notifications:requestPermission"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.requestPermission();
    expect(mockInvoke.mock.calls[0][0]).toBe('notifications:requestPermission');
  });
  it('registerActionTypes → "notifications:registerActionTypes"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.registerActionTypes([]);
    expect(mockInvoke.mock.calls[0][0]).toBe('notifications:registerActionTypes');
  });
  it('createChannel → "notifications:createChannel"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.createChannel({ id: 'c', name: 'c', importance: 'default' } as any);
    expect(mockInvoke.mock.calls[0][0]).toBe('notifications:createChannel');
  });
  it('getChannels → "notifications:getChannels"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.getChannels();
    expect(mockInvoke.mock.calls[0][0]).toBe('notifications:getChannels');
  });
  it('removeChannel → "notifications:removeChannel"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.removeChannel('c');
    expect(mockInvoke.mock.calls[0][0]).toBe('notifications:removeChannel');
  });
});
