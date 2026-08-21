/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIndexItem = vi.hoisted(() => vi.fn());
const mockDeleteItem = vi.hoisted(() => vi.fn());
const mockRegisterCommand = vi.hoisted(() => vi.fn());
const mockUnregisterCommand = vi.hoisted(() => vi.fn());
const mockShortcutUnregister = vi.hoisted(() => vi.fn());
const mockGetWindowBounds = vi.hoisted(() => vi.fn());
const mockSetWindowBounds = vi.hoisted(() => vi.fn());
const mockShowHUD = vi.hoisted(() => vi.fn());
const mockReport = vi.hoisted(() => vi.fn());

vi.mock('../../services/search/SearchService', () => ({
  searchService: {
    indexItem: mockIndexItem,
    deleteItem: mockDeleteItem,
  },
}));

vi.mock('../../services/extension/commandService.svelte', () => ({
  commandService: {
    registerCommand: mockRegisterCommand,
    unregisterCommand: mockUnregisterCommand,
  },
}));

vi.mock('../shortcuts/shortcutService', () => ({
  shortcutService: {
    unregister: mockShortcutUnregister,
  },
}));

vi.mock('../../services/windowManagement/windowManagementService', () => ({
  windowManagementService: {
    getWindowBounds: mockGetWindowBounds,
    setWindowBounds: mockSetWindowBounds,
  },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    showHUD: mockShowHUD,
    report: mockReport,
  },
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  applyCustomLayout,
  syncLayoutToIndex,
  removeLayoutFromIndex,
  deleteLayout,
  renameLayout,
} from './layoutLifecycle';
import { windowManagementState } from './state.svelte';
import type { IStorageService } from 'asyar-sdk/contracts';

function makeStore(): IStorageService {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => true),
    getAll: vi.fn(async () => ({})),
    clear: vi.fn(async () => 0),
  } as unknown as IStorageService;
}

describe('layoutLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const testLayout = {
    id: 'test-123',
    name: 'Work Layout',
    bounds: { x: 50, y: 50, width: 1200, height: 800 },
  };

  it('syncLayoutToIndex indexes item and registers command', async () => {
    await syncLayoutToIndex(testLayout);
    expect(mockIndexItem).toHaveBeenCalledWith({
      category: 'command',
      id: 'cmd_window-management_layout_test-123',
      name: 'Work Layout',
      extension: 'window-management',
      trigger: 'layout Work Layout',
      type: 'command',
      icon: 'icon:store',
    });
    expect(mockRegisterCommand).toHaveBeenCalledWith(
      'cmd_window-management_layout_test-123',
      expect.objectContaining({ execute: expect.any(Function) }),
      'window-management',
    );
  });

  it('applyCustomLayout sets window bounds and displays HUD', async () => {
    mockGetWindowBounds.mockResolvedValue({ x: 0, y: 0, width: 800, height: 600 });
    mockSetWindowBounds.mockResolvedValue(undefined);
    mockShowHUD.mockResolvedValue(undefined);

    const store = makeStore();
    await applyCustomLayout(testLayout, store);

    expect(mockSetWindowBounds).toHaveBeenCalledWith(testLayout.bounds);
    expect(mockShowHUD).toHaveBeenCalledWith('Work Layout');
  });

  it('removeLayoutFromIndex deletes from search, command and shortcut services', async () => {
    await removeLayoutFromIndex('test-123');
    expect(mockDeleteItem).toHaveBeenCalledWith('cmd_window-management_layout_test-123');
    expect(mockUnregisterCommand).toHaveBeenCalledWith('cmd_window-management_layout_test-123');
    expect(mockShortcutUnregister).toHaveBeenCalledWith('cmd_window-management_layout_test-123');
  });

  it('deleteLayout removes from state and index', async () => {
    const store = makeStore();
    vi.spyToMethod?.(windowManagementState, 'deleteCustomLayout') ||
      (windowManagementState.deleteCustomLayout = vi.fn().mockResolvedValue(undefined));
    await deleteLayout('test-123', store);
    expect(windowManagementState.deleteCustomLayout).toHaveBeenCalledWith('test-123', store);
    expect(mockDeleteItem).toHaveBeenCalledWith('cmd_window-management_layout_test-123');
  });

  it('renameLayout updates state and re-indexes layout', async () => {
    const store = makeStore();
    windowManagementState.customLayouts = [
      { id: 'test-123', name: 'Work Layout', bounds: { x: 0, y: 0, width: 800, height: 600 } },
    ];
    await renameLayout('test-123', 'New Work Layout', store);
    expect(mockIndexItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Work Layout',
        id: 'cmd_window-management_layout_test-123',
      }),
    );
  });
});
