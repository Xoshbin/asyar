import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MessageBroker BEFORE import
vi.mock('../ipc/MessageBroker', () => {
  return {
    MessageBroker: {
      getInstance: vi.fn().mockReturnValue({
        invoke: vi.fn(),
      }),
    },
  };
});

import { ApplicationServiceProxy } from './ApplicationService';
import { MessageBroker } from '../ipc/MessageBroker';

describe('ApplicationServiceProxy', () => {
  let proxy: ApplicationServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = MessageBroker.getInstance();
    proxy = new ApplicationServiceProxy();
  });

  it('getFrontmostApplication() calls broker with correct type string', async () => {
    const mockApp = { name: 'Safari', bundleId: 'com.apple.Safari', windowTitle: 'Apple' };
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(mockApp);

    const result = await proxy.getFrontmostApplication();

    expect(mockBroker.invoke).toHaveBeenCalledWith('application:getFrontmostApplication');
    expect(result).toEqual(mockApp);
  });

  it('syncApplicationIndex() calls broker with correct type string and payload', async () => {
    const mockResult = { added: 5, removed: 2, total: 100 };
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(mockResult);

    const result = await proxy.syncApplicationIndex(['/extra/path']);

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'application:syncApplicationIndex',
      { extraPaths: ['/extra/path'] }
    );
    expect(result).toEqual(mockResult);
  });

  it('syncApplicationIndex() passes undefined extraPaths when not provided', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce({ added: 0, removed: 0, total: 50 });

    await proxy.syncApplicationIndex();

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'application:syncApplicationIndex',
      { extraPaths: undefined }
    );
  });

  it('listApplications() calls broker with correct type string and payload', async () => {
    const mockApps = [{ name: 'Safari', path: '/Applications/Safari.app' }];
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(mockApps);

    const result = await proxy.listApplications(['/custom/path']);

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'application:listApplications',
      { extraPaths: ['/custom/path'] }
    );
    expect(result).toEqual(mockApps);
  });

  it('listApplications() passes undefined extraPaths when not provided', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);

    await proxy.listApplications();

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'application:listApplications',
      { extraPaths: undefined }
    );
  });

  it('type strings do NOT include asyar:service: prefix (MessageBroker adds asyar:api:)', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValue({});

    await proxy.getFrontmostApplication();
    await proxy.syncApplicationIndex();
    await proxy.listApplications();

    const calls = vi.mocked(mockBroker.invoke).mock.calls;
    for (const [typeString] of calls) {
      expect(typeString).not.toContain('asyar:');
    }
  });
});
