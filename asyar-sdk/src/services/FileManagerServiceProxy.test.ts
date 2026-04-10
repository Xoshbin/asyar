import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileManagerServiceProxy } from './FileManagerServiceProxy';
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
  const mockInvoke = vi.fn();
  vi.mocked(MessageBroker.getInstance).mockReturnValue({
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  } as any);
  const proxy = new FileManagerServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('FileManagerServiceProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('showInFileManager calls broker.invoke with correct type and payload', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(undefined);

    await proxy.showInFileManager('/some/path');

    const [cmd, payload] = mockInvoke.mock.calls[0];
    expect(cmd).toBe('filemanager:showInFileManager');
    expect(payload).toEqual({ path: '/some/path' });
  });

  it('trash calls broker.invoke with correct type and payload', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(undefined);

    await proxy.trash('/some/path');

    const [cmd, payload] = mockInvoke.mock.calls[0];
    expect(cmd).toBe('filemanager:trash');
    expect(payload).toEqual({ path: '/some/path' });
  });
});
