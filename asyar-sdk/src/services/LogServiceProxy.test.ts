import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LogServiceProxy } from './LogServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(() => ({
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    })),
  },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  vi.mocked(MessageBroker.getInstance).mockReturnValue({
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  } as any);
  const proxy = new LogServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('LogServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('debug → "log:debug"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.debug('test message');
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'log:debug',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ message: 'test message' });
  });

  it('info → "log:info"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.info('hello');
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'log:info',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ message: 'hello' });
  });

  it('warn → "log:warn"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.warn('caution');
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'log:warn',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ message: 'caution' });
  });

  it('error with string → "log:error"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.error('something broke');
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'log:error',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ message: 'something broke' });
  });

  it('error with Error object → "log:error" extracts .message', async () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.error(new Error('err obj'));
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'log:error',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ message: 'err obj' });
  });

  it('custom → "log:custom" with category, colorName, frameName', async () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.custom('msg', 'myCategory', 'blue', 'frame1');
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'log:custom',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({
      message: 'msg',
      category: 'myCategory',
      colorName: 'blue',
      frameName: 'frame1',
    });
  });

  it('custom without frameName → "log:custom" with frameName undefined', async () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.custom('msg', 'cat', 'red');
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'log:custom',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({
      message: 'msg',
      category: 'cat',
      colorName: 'red',
    });
    expect(call![1].frameName).toBeUndefined();
  });
});
