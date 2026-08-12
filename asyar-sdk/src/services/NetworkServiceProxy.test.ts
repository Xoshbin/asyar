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
  const eventListeners = new Map<string, Set<(payload: any) => void>>();
  const mockOn = vi.fn().mockImplementation((event: string, callback: (payload: any) => void) => {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, new Set());
    }
    eventListeners.get(event)!.add(callback);
  });
  const mockOff = vi.fn().mockImplementation((event: string, callback: (payload: any) => void) => {
    eventListeners.get(event)?.delete(callback);
  });
  Object.assign(messageBroker, {
    invoke: mockInvoke,
    on: mockOn,
    off: mockOff,
  });
  const proxy = new NetworkServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke, mockOn, mockOff, eventListeners };
}

/** Fire a push event to all registered listeners for the given event type. */
function firePush(eventListeners: Map<string, Set<(payload: any) => void>>, payload: any): void {
  const listeners = eventListeners.get('asyar:event:network:wsMessage:push');
  if (listeners) {
    listeners.forEach((cb) => cb(payload));
  }
}

describe('NetworkServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetch → "network:fetch" with url and default options', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.fetch('https://example.com');
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'network:fetch');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ url: 'https://example.com', options: {} });
  });

  it('fetch → "network:fetch" with custom options', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const opts = { method: 'POST' as const, body: '{}', timeout: 5000 };
    await proxy.fetch('https://example.com/api', opts);
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'network:fetch');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({
      url: 'https://example.com/api',
      options: opts,
    });
  });

  it('connectWebSocket → invokes "network:wsConnect" and registers event listener', async () => {
    const { proxy, mockInvoke, mockOn, eventListeners } = makeProxy();
    const handle = await proxy.connectWebSocket('wss://echo.websocket.org');

    expect(handle.socketId).toMatch(/^ws_/);
    const connectCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'network:wsConnect');
    expect(connectCall).toBeDefined();
    expect(connectCall![1]).toMatchObject({
      socketId: handle.socketId,
      url: 'wss://echo.websocket.org',
    });

    expect(mockOn).toHaveBeenCalledWith('asyar:event:network:wsMessage:push', expect.any(Function));

    // Test listener callbacks
    const onOpenCb = vi.fn();
    const onMessageCb = vi.fn();
    handle.onOpen(onOpenCb);
    handle.onMessage(onMessageCb);

    firePush(eventListeners, {
      socket_id: handle.socketId,
      event_type: 'open',
    });
    expect(onOpenCb).toHaveBeenCalledTimes(1);

    firePush(eventListeners, {
      socket_id: handle.socketId,
      event_type: 'message',
      data: 'hello websocket',
    });
    expect(onMessageCb).toHaveBeenCalledWith('hello websocket');
  });

  it('onOpen replays buffered open event if it already fired', async () => {
    const { proxy, eventListeners } = makeProxy();
    const handle = await proxy.connectWebSocket('wss://echo.websocket.org');

    // Fire open BEFORE registering callback
    firePush(eventListeners, {
      socket_id: handle.socketId,
      event_type: 'open',
    });

    const onOpenCb = vi.fn();
    handle.onOpen(onOpenCb);
    // Should be called immediately with the buffered event
    expect(onOpenCb).toHaveBeenCalledTimes(1);
  });

  it('onClose replays buffered close event if it already fired', async () => {
    const { proxy, eventListeners } = makeProxy();
    const handle = await proxy.connectWebSocket('wss://echo.websocket.org');

    // Fire close BEFORE registering callback
    firePush(eventListeners, {
      socket_id: handle.socketId,
      event_type: 'close',
      code: 1000,
      data: 'normal closure',
    });

    const onCloseCb = vi.fn();
    handle.onClose(onCloseCb);
    expect(onCloseCb).toHaveBeenCalledWith({ code: 1000, reason: 'normal closure' });
  });

  it('close event unsubscribes the listener via broker.off', async () => {
    const { proxy, mockOff, eventListeners } = makeProxy();
    const handle = await proxy.connectWebSocket('wss://echo.websocket.org');

    firePush(eventListeners, {
      socket_id: handle.socketId,
      event_type: 'close',
      code: 1000,
    });

    expect(mockOff).toHaveBeenCalledWith(
      'asyar:event:network:wsMessage:push',
      expect.any(Function),
    );
  });

  it('handle.send → invokes "network:wsSend"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const handle = await proxy.connectWebSocket('wss://echo.websocket.org');
    await handle.send('test payload');

    const sendCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'network:wsSend');
    expect(sendCall).toBeDefined();
    expect(sendCall![1]).toEqual({
      socketId: handle.socketId,
      message: 'test payload',
    });
  });

  it('handle.close → invokes "network:wsClose"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const handle = await proxy.connectWebSocket('wss://echo.websocket.org');
    await handle.close(1000, 'normal closure');

    const closeCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'network:wsClose');
    expect(closeCall).toBeDefined();
    expect(closeCall![1]).toEqual({
      socketId: handle.socketId,
      code: 1000,
      reason: 'normal closure',
    });
  });

  it('ignores events for other socket IDs', async () => {
    const { proxy, eventListeners } = makeProxy();
    const handle = await proxy.connectWebSocket('wss://echo.websocket.org');

    const onMessageCb = vi.fn();
    handle.onMessage(onMessageCb);

    firePush(eventListeners, {
      socket_id: 'ws_other_socket',
      event_type: 'message',
      data: 'should be ignored',
    });

    expect(onMessageCb).not.toHaveBeenCalled();
  });
});
