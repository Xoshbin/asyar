/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/windowManagement/windowManagementService', () => ({
  windowManagementService: {
    getWindowBounds: vi.fn(),
    setWindowBounds: vi.fn(),
    setFullscreen: vi.fn(),
    getMonitors: vi.fn(),
    applyPreset: vi.fn(),
  },
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    showHUD: vi.fn(),
    report: vi.fn(),
  },
}));
vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
  },
}));
vi.mock('./state.svelte', () => ({
  windowManagementState: {
    customLayouts: [],
    previousBounds: null,
    selectedIndex: 0,
    selectedLayout: null,
    setStore: vi.fn(),
    loadFromStorage: vi.fn(),
    savePreviousBounds: vi.fn(),
    addCustomLayout: vi.fn(),
    deleteCustomLayout: vi.fn(),
    renameCustomLayout: vi.fn(),
    setIndex: vi.fn(),
    moveSelection: vi.fn(),
  },
}));
vi.mock('./layoutLifecycle', () => ({
  applyCustomLayout: vi.fn(),
  syncLayoutToIndex: vi.fn(),
  removeLayoutFromIndex: vi.fn(),
}));
vi.mock('./ManageView.svelte', () => ({ default: {} }));

import extension from './index';
import { windowManagementService } from '../../services/windowManagement/windowManagementService';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { windowManagementState } from './state.svelte';
import { applyCustomLayout } from './layoutLifecycle';
import type { ExtensionContext } from 'asyar-sdk/contracts';

function makeContext(): ExtensionContext {
  return {
    getService: vi.fn().mockImplementation((name: string) => {
      if (name === 'storage')
        return { get: vi.fn(async () => null), set: vi.fn(), delete: vi.fn() };
      if (name === 'extensions')
        return { navigateToView: vi.fn(), setActiveViewActionLabel: vi.fn() };
      return null;
    }),
  } as unknown as ExtensionContext;
}

describe('WindowManagementExtension', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('initialize', () => {
    it('resolves StorageService and loads state', async () => {
      const ctx = makeContext();
      await extension.initialize(ctx);
      expect(ctx.getService).toHaveBeenCalledWith('storage');
      expect(windowManagementState.loadFromStorage).toHaveBeenCalled();
    });
  });

  describe('executeCommand — layout presets', () => {
    beforeEach(async () => {
      await extension.initialize(makeContext());
      vi.mocked(windowManagementService.getWindowBounds).mockResolvedValue({
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
      });
      vi.mocked(windowManagementService.applyPreset).mockResolvedValue();
      vi.mocked(feedbackService.showHUD).mockResolvedValue();
    });

    it('left-half saves previous bounds then calls applyPreset and returns no-view', async () => {
      const result = await extension.executeCommand('left-half');
      expect(windowManagementState.savePreviousBounds).toHaveBeenCalled();
      expect(windowManagementService.applyPreset).toHaveBeenCalledWith('left-half');
      expect(feedbackService.showHUD).toHaveBeenCalledWith('Left Half');
      expect(result).toEqual({ type: 'no-view' });
    });

    it('first-fourth saves previous bounds then calls applyPreset and returns no-view', async () => {
      const result = await extension.executeCommand('first-fourth');
      expect(windowManagementState.savePreviousBounds).toHaveBeenCalled();
      expect(windowManagementService.applyPreset).toHaveBeenCalledWith('first-fourth');
      expect(feedbackService.showHUD).toHaveBeenCalledWith('First Fourth');
      expect(result).toEqual({ type: 'no-view' });
    });

    it('last-fourth saves previous bounds then calls applyPreset and returns no-view', async () => {
      const result = await extension.executeCommand('last-fourth');
      expect(windowManagementState.savePreviousBounds).toHaveBeenCalled();
      expect(windowManagementService.applyPreset).toHaveBeenCalledWith('last-fourth');
      expect(feedbackService.showHUD).toHaveBeenCalledWith('Last Fourth');
      expect(result).toEqual({ type: 'no-view' });
    });

    it('next-display saves previous bounds then calls applyPreset and returns no-view', async () => {
      const result = await extension.executeCommand('next-display');
      expect(windowManagementState.savePreviousBounds).toHaveBeenCalled();
      expect(windowManagementService.applyPreset).toHaveBeenCalledWith('next-display');
      expect(feedbackService.showHUD).toHaveBeenCalledWith('Next Display');
      expect(result).toEqual({ type: 'no-view' });
    });

    it('previous-display saves previous bounds then calls applyPreset and returns no-view', async () => {
      const result = await extension.executeCommand('previous-display');
      expect(windowManagementState.savePreviousBounds).toHaveBeenCalled();
      expect(windowManagementService.applyPreset).toHaveBeenCalledWith('previous-display');
      expect(feedbackService.showHUD).toHaveBeenCalledWith('Previous Display');
      expect(result).toEqual({ type: 'no-view' });
    });

    it('reports error diagnostic when getWindowBounds throws', async () => {
      vi.mocked(windowManagementService.getWindowBounds).mockRejectedValue(
        new Error('Accessibility permission required'),
      );
      vi.mocked(feedbackService.report).mockResolvedValue();
      const result = await extension.executeCommand('left-half');
      expect(feedbackService.report).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'manual',
          severity: 'error',
          context: expect.objectContaining({
            message: expect.stringContaining('Could not apply layout'),
          }),
        }),
      );
      expect(result).toEqual({ type: 'no-view' });
    });
  });

  describe('executeCommand — save-current-layout', () => {
    beforeEach(async () => {
      await extension.initialize(makeContext());
      vi.mocked(windowManagementService.getWindowBounds).mockResolvedValue({
        x: 100,
        y: 100,
        width: 1200,
        height: 800,
      });
      vi.mocked(feedbackService.showHUD).mockResolvedValue();
    });

    it('captures window bounds, adds custom layout and returns no-view', async () => {
      const result = await extension.executeCommand('save-current-layout');
      expect(windowManagementService.getWindowBounds).toHaveBeenCalled();
      expect(windowManagementState.addCustomLayout).toHaveBeenCalledWith(
        '1200x800',
        { x: 100, y: 100, width: 1200, height: 800 },
        expect.anything(),
      );
      expect(feedbackService.showHUD).toHaveBeenCalledWith('Saved "1200x800"');
      expect(result).toEqual({ type: 'no-view' });
    });
  });

  describe('executeCommand — restore', () => {
    beforeEach(async () => {
      await extension.initialize(makeContext());
    });

    it('calls setWindowBounds with previousBounds when available and returns no-view', async () => {
      const prev = { x: 100, y: 100, width: 800, height: 600 };
      Object.defineProperty(windowManagementState, 'previousBounds', {
        value: prev,
        configurable: true,
      });
      vi.mocked(windowManagementService.setWindowBounds).mockResolvedValue();
      vi.mocked(feedbackService.showHUD).mockResolvedValue();
      const result = await extension.executeCommand('restore');
      expect(windowManagementService.setWindowBounds).toHaveBeenCalledWith(prev);
      expect(result).toEqual({ type: 'no-view' });
    });

    it('reports error diagnostic when nothing to restore and returns no-view', async () => {
      Object.defineProperty(windowManagementState, 'previousBounds', {
        value: null,
        configurable: true,
      });
      vi.mocked(feedbackService.report).mockResolvedValue();
      const result = await extension.executeCommand('restore');
      expect(feedbackService.report).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'manual',
          severity: 'error',
          context: expect.objectContaining({
            message: expect.stringContaining('Nothing to restore'),
          }),
        }),
      );
      expect(result).toEqual({ type: 'no-view' });
    });
  });

  describe('executeCommand — manage-layouts', () => {
    it('navigates to ManageView and returns view type', async () => {
      const ctx = makeContext();
      await extension.initialize(ctx);
      const result = await extension.executeCommand('manage-layouts');
      expect(result).toMatchObject({ type: 'view', viewPath: 'window-management/ManageView' });
    });
  });

  describe('executeCommand — apply-layout', () => {
    const layout = {
      id: 'videocall-id',
      name: 'Videocall',
      bounds: { x: 100, y: 100, width: 600, height: 400 },
    };

    beforeEach(async () => {
      await extension.initialize(makeContext());
      Object.defineProperty(windowManagementState, 'customLayouts', {
        value: [layout],
        configurable: true,
      });
    });

    it('applies layout by name case-insensitively', async () => {
      const result = await extension.executeCommand('apply-layout', { name: 'videocall' });

      expect(applyCustomLayout).toHaveBeenCalledWith(layout, expect.anything());
      expect(result).toEqual({ type: 'no-view' });
    });

    it('applies layout by id', async () => {
      const result = await extension.executeCommand('apply-layout', { id: 'videocall-id' });

      expect(applyCustomLayout).toHaveBeenCalledWith(layout, expect.anything());
      expect(result).toEqual({ type: 'no-view' });
    });

    it('reports error when layout is not found', async () => {
      vi.mocked(feedbackService.report).mockResolvedValue();

      const result = await extension.executeCommand('apply-layout', { name: 'Nonexistent' });

      expect(feedbackService.showHUD).toHaveBeenCalledWith(expect.stringContaining('Nonexistent'));
      expect(feedbackService.report).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'manual',
          severity: 'error',
          context: expect.objectContaining({
            message: expect.stringContaining('Nonexistent'),
          }),
        }),
      );
      expect(result).toEqual({ type: 'no-view' });
    });

    it('reports error when neither name nor id is provided', async () => {
      vi.mocked(feedbackService.report).mockResolvedValue();

      const result = await extension.executeCommand('apply-layout', {});

      expect(feedbackService.showHUD).toHaveBeenCalledWith('No layout name or ID provided');
      expect(feedbackService.report).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'manual',
          severity: 'error',
          context: expect.objectContaining({
            message: expect.stringContaining('No layout name or ID provided'),
          }),
        }),
      );
      expect(result).toEqual({ type: 'no-view' });
    });
  });

  describe('search', () => {
    it('returns custom layouts as ExtensionResult entries', async () => {
      const layout = {
        id: '1',
        name: 'My Layout',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      };
      Object.defineProperty(windowManagementState, 'customLayouts', {
        value: [layout],
        configurable: true,
      });
      await extension.initialize(makeContext());
      const results = await extension.search('my');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('My Layout');
      expect(results[0].id).toBe('cmd_window-management_layout_1');
    });

    it('returns empty array when no custom layouts match', async () => {
      Object.defineProperty(windowManagementState, 'customLayouts', {
        value: [],
        configurable: true,
      });
      await extension.initialize(makeContext());
      const results = await extension.search('anything');
      expect(results).toEqual([]);
    });
  });
});
