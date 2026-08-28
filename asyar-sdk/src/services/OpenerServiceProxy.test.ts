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

  it('openPath → "opener:openPath" with { path, options }', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(undefined);

    await proxy.openPath('/path/to/project', { with: 'Zed' });

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'opener:openPath');
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual({ path: '/path/to/project', options: { with: 'Zed' } });
  });

  it('openPath → "opener:openPath" with path only', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(undefined);

    await proxy.openPath('/path/to/file.txt');

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'opener:openPath');
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual({ path: '/path/to/file.txt', options: undefined });
  });

  it('reveal → "opener:reveal" with { path }', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(undefined);

    await proxy.reveal('/path/to/file.txt');

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'opener:reveal');
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual({ path: '/path/to/file.txt' });
  });

  it('propagates invocation errors/rejections from the message broker', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockRejectedValue(new Error('Permission denied: shell:open-url required'));

    await expect(proxy.openUrl('steam://run/3932890')).rejects.toThrow(
      'Permission denied: shell:open-url required',
    );
  });

  it('propagates openPath permission errors', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockRejectedValue(
      new Error('Extension "ext.test" requires the "shell:open-path" permission.'),
    );

    await expect(proxy.openPath('/path/to/project')).rejects.toThrow('shell:open-path');
  });

  it('propagates reveal permission errors', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockRejectedValue(
      new Error('Extension "ext.test" requires the "fs:read" permission.'),
    );

    await expect(proxy.reveal('/path/to/file.txt')).rejects.toThrow('fs:read');
  });
});
