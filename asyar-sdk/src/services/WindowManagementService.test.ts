import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn() },
}));

import { messageBroker } from '../ipc/MessageBroker';
import { WindowManagementServiceProxy } from './WindowManagementService';

describe('WindowManagementServiceProxy', () => {
  let mockBroker: { invoke: ReturnType<typeof vi.fn> };
  let proxy: WindowManagementServiceProxy;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker as any;
    proxy = new WindowManagementServiceProxy();
  });

  it('getWindowBounds calls correct IPC key', async () => {
    const bounds = { x: 0, y: 0, width: 1280, height: 800 };
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(bounds);

    const result = await proxy.getWindowBounds();

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:getWindowBounds');
    expect(result).toEqual(bounds);
  });

  it('setWindowBounds calls correct IPC key with partial update', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);

    await proxy.setWindowBounds({ width: 800, height: 600 });

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:setWindowBounds', {
      x: undefined,
      y: undefined,
      width: 800,
      height: 600,
    });
  });

  it('setFullscreen calls correct IPC key with enable=true', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);

    await proxy.setFullscreen(true);

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:setFullscreen', { enable: true });
  });

  it('setFullscreen calls correct IPC key with enable=false', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);

    await proxy.setFullscreen(false);

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:setFullscreen', { enable: false });
  });

  it('getMonitors calls correct IPC key', async () => {
    const monitors = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(monitors);

    const result = await proxy.getMonitors();

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:getMonitors');
    expect(result).toEqual(monitors);
  });

  it('applyPreset calls correct IPC key', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);

    await proxy.applyPreset('left-half');

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:applyPreset', { presetId: 'left-half' });
  });

  it('previousDisplay calls window:applyPreset with previous-display', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);

    await proxy.previousDisplay();

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:applyPreset', {
      presetId: 'previous-display',
    });
  });

  it('nextDisplay calls window:applyPreset with next-display', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);

    await proxy.nextDisplay();

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:applyPreset', {
      presetId: 'next-display',
    });
  });

  it('getWindowBounds forwards windowId when provided', async () => {
    const bounds = { x: 10, y: 20, width: 500, height: 400 };
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(bounds);

    const result = await proxy.getWindowBounds('macos:100:200');

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:getWindowBounds', {
      windowId: 'macos:100:200',
    });
    expect(result).toEqual(bounds);
  });

  it('setWindowBounds forwards windowId when provided', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);

    await proxy.setWindowBounds({ x: 10, y: 20 }, 'win:12345');

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:setWindowBounds', {
      x: 10,
      y: 20,
      width: undefined,
      height: undefined,
      windowId: 'win:12345',
    });
  });

  it('listWindows calls window:listWindows', async () => {
    const windows = [
      {
        id: 'macos:1:2',
        pid: 1,
        appName: 'Code',
        title: 'main.ts',
        isMinimized: false,
        isFocused: true,
      },
    ];
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(windows);

    const result = await proxy.listWindows();

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:listWindows');
    expect(result).toEqual(windows);
  });

  it('focusWindow calls window:focusWindow with id', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);

    await proxy.focusWindow('linux:999');

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:focusWindow', { id: 'linux:999' });
  });
});
