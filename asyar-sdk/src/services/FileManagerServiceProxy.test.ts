import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileManagerServiceProxy } from './FileManagerServiceProxy';
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
  const proxy = new FileManagerServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('FileManagerServiceProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('showInFileManager → "fs:showInFileManager"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(undefined);

    await proxy.showInFileManager('/some/path');

    const call = mockInvoke.mock.calls.find(c => c[0] === 'fs:showInFileManager');
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual({ path: '/some/path' });
  });

  it('trash → "fs:trash"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(undefined);

    await proxy.trash('/some/path');

    const call = mockInvoke.mock.calls.find(c => c[0] === 'fs:trash');
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual({ path: '/some/path' });
  });
});
