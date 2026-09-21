import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../lib/ipc/commands', () => ({
  windowGetBounds: vi.fn(),
  windowSetBounds: vi.fn(),
  windowSetFullscreen: vi.fn(),
  windowGetMonitors: vi.fn(),
  windowApplyPreset: vi.fn(),
  windowListWindows: vi.fn(),
  windowFocusWindow: vi.fn(),
  windowCloseWindow: vi.fn(),
}));

import * as commands from '../../lib/ipc/commands';
import { WindowManagementService } from './windowManagementService';

describe('WindowManagementService', () => {
  let service: WindowManagementService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WindowManagementService();
  });

  describe('getWindowBounds', () => {
    it('calls windowGetBounds and returns result', async () => {
      const bounds = { x: 100, y: 200, width: 1280, height: 800 };
      vi.mocked(commands.windowGetBounds).mockResolvedValueOnce(bounds);

      const result = await service.getWindowBounds();

      expect(commands.windowGetBounds).toHaveBeenCalledOnce();
      expect(result).toEqual(bounds);
    });
  });

  describe('setWindowBounds', () => {
    it('calls windowSetBounds with partial update', async () => {
      vi.mocked(commands.windowSetBounds).mockResolvedValueOnce(undefined);

      await service.setWindowBounds({ width: 800, height: 600 });

      expect(commands.windowSetBounds).toHaveBeenCalledWith({ width: 800, height: 600 });
    });

    it('calls windowSetBounds with x and y only', async () => {
      vi.mocked(commands.windowSetBounds).mockResolvedValueOnce(undefined);

      await service.setWindowBounds({ x: 0, y: 0 });

      expect(commands.windowSetBounds).toHaveBeenCalledWith({ x: 0, y: 0 });
    });
  });

  describe('setFullscreen', () => {
    it('calls windowSetFullscreen with enable=true', async () => {
      vi.mocked(commands.windowSetFullscreen).mockResolvedValueOnce(undefined);

      await service.setFullscreen(true);

      expect(commands.windowSetFullscreen).toHaveBeenCalledWith(true);
    });

    it('calls windowSetFullscreen with enable=false', async () => {
      vi.mocked(commands.windowSetFullscreen).mockResolvedValueOnce(undefined);

      await service.setFullscreen(false);

      expect(commands.windowSetFullscreen).toHaveBeenCalledWith(false);
    });
  });

  describe('getMonitors', () => {
    it('calls windowGetMonitors and returns result', async () => {
      const monitors = [{ x: 0, y: 0, width: 1920, height: 1080 }];
      vi.mocked(commands.windowGetMonitors).mockResolvedValueOnce(monitors);

      const result = await service.getMonitors();

      expect(commands.windowGetMonitors).toHaveBeenCalledOnce();
      expect(result).toEqual(monitors);
    });
  });

  describe('applyPreset', () => {
    it('calls windowApplyPreset with presetId', async () => {
      vi.mocked(commands.windowApplyPreset).mockResolvedValueOnce(undefined);

      await service.applyPreset('left-half');

      expect(commands.windowApplyPreset).toHaveBeenCalledWith('left-half');
    });
  });

  describe('previousDisplay', () => {
    it('calls windowApplyPreset with previous-display', async () => {
      vi.mocked(commands.windowApplyPreset).mockResolvedValueOnce(undefined);

      await service.previousDisplay();

      expect(commands.windowApplyPreset).toHaveBeenCalledWith('previous-display');
    });
  });

  describe('nextDisplay', () => {
    it('calls windowApplyPreset with next-display', async () => {
      vi.mocked(commands.windowApplyPreset).mockResolvedValueOnce(undefined);

      await service.nextDisplay();

      expect(commands.windowApplyPreset).toHaveBeenCalledWith('next-display');
    });
  });

  describe('listWindows', () => {
    it('calls windowListWindows and returns windows array', async () => {
      const windows = [
        {
          id: '123',
          pid: 456,
          appName: 'Safari',
          appBundleId: 'com.apple.Safari',
          title: 'GitHub',
          isMinimized: false,
          isFocused: true,
          appIcon: null,
        },
      ];
      vi.mocked(commands.windowListWindows).mockResolvedValueOnce(windows);

      const result = await service.listWindows();

      expect(commands.windowListWindows).toHaveBeenCalledOnce();
      expect(result).toEqual(windows);
    });

    it('returns empty array if windowListWindows returns null', async () => {
      vi.mocked(commands.windowListWindows).mockResolvedValueOnce(null);

      const result = await service.listWindows();

      expect(commands.windowListWindows).toHaveBeenCalledOnce();
      expect(result).toEqual([]);
    });
  });

  describe('focusWindow', () => {
    it('calls windowFocusWindow with window id', async () => {
      vi.mocked(commands.windowFocusWindow).mockResolvedValueOnce(undefined);

      await service.focusWindow('123');

      expect(commands.windowFocusWindow).toHaveBeenCalledWith('123');
    });
  });

  describe('closeWindow', () => {
    it('calls windowCloseWindow with window id', async () => {
      vi.mocked(commands.windowCloseWindow).mockResolvedValueOnce(undefined);

      await service.closeWindow('123');

      expect(commands.windowCloseWindow).toHaveBeenCalledWith('123');
    });
  });
});
