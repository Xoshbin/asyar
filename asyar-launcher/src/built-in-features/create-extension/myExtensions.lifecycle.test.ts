/** @vitest-environment jsdom */
/**
 * Contract tests for the "My Extensions" command lifecycle in index.ts.
 *
 * Tests cover:
 *  - executeCommand("my-extensions") navigates to CreatedExtensionsView
 *  - viewActivated with CreatedExtensionsView id:
 *      - registers keydown listener
 *      - loads createdExtensionsViewState
 *      - sets action label to "Open"
 *      - registers ai-builder:open-created and ai-builder:publish-created actions
 *  - viewDeactivated with CreatedExtensionsView id:
 *      - removes keydown listener
 *      - unregisters the two actions
 *      - resets the view state
 *  - onViewSearch forwards query to createdExtensionsViewState.setSearch
 *  - ArrowUp/ArrowDown keydown calls moveSelection
 *  - Enter keydown calls openInEditor for selectedItem
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks — must be before any imports ─────────────────────────────

const mockNavigateToView = vi.hoisted(() => vi.fn());
const mockSetActiveViewActionLabel = vi.hoisted(() => vi.fn());
const mockGetService = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    navigateToView: mockNavigateToView,
    setActiveViewActionLabel: mockSetActiveViewActionLabel,
  }),
);
const mockRegisterCommand = vi.hoisted(() => vi.fn());
const mockLoad = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSetSearch = vi.hoisted(() => vi.fn());
const mockMoveSelection = vi.hoisted(() => vi.fn());
const mockReset = vi.hoisted(() => vi.fn());
const mockRegisterAction = vi.hoisted(() => vi.fn());
const mockUnregisterAction = vi.hoisted(() => vi.fn());
const mockOpenInEditor = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// ── module mocks ───────────────────────────────────────────────────────────

// logService (pulled in transitively)
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Tauri API (pulled in transitively)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn().mockResolvedValue('/home/u'),
  join: vi.fn(async (...p: string[]) => p.join('/')),
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn().mockReturnValue('macos') }));
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn(() => ({ execute: vi.fn().mockResolvedValue(undefined) })) } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn().mockResolvedValue(undefined) }));
vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn().mockResolvedValue(undefined) }));

// asyar-sdk/contracts
vi.mock('asyar-sdk/contracts', () => ({
  ActionContext: { EXTENSION_VIEW: 'EXTENSION_VIEW' },
}));

// Services pulled in by actionService.svelte
vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: mockRegisterAction,
    unregisterAction: mockUnregisterAction,
    setActionExecutor: vi.fn(),
  },
}));
vi.mock('../../services/search/SearchService', () => ({
  searchService: { search: vi.fn(), getResults: vi.fn().mockReturnValue([]) },
}));
vi.mock('../../services/search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: { query: '', results: [] },
}));
vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: { query: '', setQuery: vi.fn() },
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { confirmAlert: vi.fn().mockResolvedValue(false), alert: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../services/application/applicationService', () => ({
  applicationService: { scan: vi.fn().mockResolvedValue({ apps: [] }) },
}));
vi.mock('../../services/settings/developerSettingsService.svelte', () => ({
  developerSettingsService: { settings: {} },
}));
vi.mock('../../services/performance/performanceService.svelte', () => ({
  performanceService: { metrics: {} },
}));
vi.mock('../../services/run/runService.svelte', () => ({
  runService: { active: [], recent: [], selectedRunId: null },
}));
vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn(), activeView: null },
}));

// createdExtensionsViewState — selectedItem controlled per-test
let _selectedItem: { path: string } | null = null;
vi.mock('./ai-builder/createdExtensionsViewState.svelte', () => ({
  createdExtensionsViewState: {
    load: mockLoad,
    setSearch: mockSetSearch,
    moveSelection: mockMoveSelection,
    reset: mockReset,
    get selectedItem() { return _selectedItem; },
    filtered: vi.fn().mockReturnValue([]),
    get selectedIndex() { return 0; },
    items: [],
  },
}));

vi.mock('./ai-builder/openInEditor', () => ({ openInEditor: mockOpenInEditor }));
vi.mock('./ai-builder/publishExtension', () => ({
  publishExtension: vi.fn().mockResolvedValue(undefined),
}));

// orchestrator mock (ensureListening is called in initialize)
vi.mock('./ai-builder/orchestrator', () => ({ ensureListening: vi.fn().mockResolvedValue(undefined) }));

// aiBuildUiState mock
vi.mock('./ai-builder/aiBuildUiState.svelte', () => ({
  aiBuildUiState: { openTrigger: null },
}));

// Svelte component mocks (not used in tests but imported for exports)
vi.mock('./CreateExtensionView.svelte', () => ({ default: {} }));
vi.mock('./ai-builder/BuildProgressView.svelte', () => ({ default: {} }));
vi.mock('./ai-builder/CreatedExtensionsView.svelte', () => ({ default: {} }));

import createExtensionDefault from './index';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeContext() {
  return {
    getService: mockGetService,
    registerCommand: mockRegisterCommand,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _selectedItem = null;
  mockGetService.mockReturnValue({
    navigateToView: mockNavigateToView,
    setActiveViewActionLabel: mockSetActiveViewActionLabel,
  });
});

const MY_EXT_VIEW_ID = 'create-extension/CreatedExtensionsView';

// ── tests ────────────────────────────────────────────────────────────────────

describe('my-extensions command lifecycle', () => {
  it('executeCommand("my-extensions") navigates to CreatedExtensionsView', async () => {
    await createExtensionDefault.initialize(makeContext() as any);
    await createExtensionDefault.executeCommand('my-extensions');
    expect(mockNavigateToView).toHaveBeenCalledWith(MY_EXT_VIEW_ID);
  });

  it('viewActivated loads view state and registers actions', async () => {
    await createExtensionDefault.initialize(makeContext() as any);
    await createExtensionDefault.viewActivated(MY_EXT_VIEW_ID);

    expect(mockLoad).toHaveBeenCalled();
    expect(mockSetActiveViewActionLabel).toHaveBeenCalledWith('Open');
    const registeredIds = mockRegisterAction.mock.calls.map((c: any[]) => c[0].id);
    expect(registeredIds).toContain('ai-builder:open-created');
    expect(registeredIds).toContain('ai-builder:publish-created');
  });

  it('viewDeactivated unregisters actions and resets state', async () => {
    await createExtensionDefault.initialize(makeContext() as any);
    await createExtensionDefault.viewActivated(MY_EXT_VIEW_ID);
    await createExtensionDefault.viewDeactivated(MY_EXT_VIEW_ID);

    expect(mockUnregisterAction).toHaveBeenCalledWith('ai-builder:open-created');
    expect(mockUnregisterAction).toHaveBeenCalledWith('ai-builder:publish-created');
    expect(mockReset).toHaveBeenCalled();
    expect(mockSetActiveViewActionLabel).toHaveBeenCalledWith(null);
  });

  it('onViewSearch forwards query to createdExtensionsViewState.setSearch', async () => {
    await createExtensionDefault.initialize(makeContext() as any);
    await createExtensionDefault.onViewSearch('hello');
    expect(mockSetSearch).toHaveBeenCalledWith('hello');
  });

  describe('keydown handler (active after viewActivated)', () => {
    it('ArrowDown calls moveSelection("down")', async () => {
      await createExtensionDefault.initialize(makeContext() as any);
      await createExtensionDefault.viewActivated(MY_EXT_VIEW_ID);

      const evt = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(evt, 'preventDefault');
      window.dispatchEvent(evt);
      await Promise.resolve();

      expect(mockMoveSelection).toHaveBeenCalledWith('down');
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('ArrowUp calls moveSelection("up")', async () => {
      await createExtensionDefault.initialize(makeContext() as any);
      await createExtensionDefault.viewActivated(MY_EXT_VIEW_ID);

      const evt = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
      window.dispatchEvent(evt);
      await Promise.resolve();

      expect(mockMoveSelection).toHaveBeenCalledWith('up');
    });

    it('Enter calls openInEditor for selectedItem', async () => {
      _selectedItem = { path: '/ext/myext' };
      await createExtensionDefault.initialize(makeContext() as any);
      await createExtensionDefault.viewActivated(MY_EXT_VIEW_ID);

      const evt = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      window.dispatchEvent(evt);
      await Promise.resolve();

      expect(mockOpenInEditor).toHaveBeenCalledWith('/ext/myext');
    });

    it('keydown listener is removed after viewDeactivated', async () => {
      await createExtensionDefault.initialize(makeContext() as any);
      await createExtensionDefault.viewActivated(MY_EXT_VIEW_ID);
      await createExtensionDefault.viewDeactivated(MY_EXT_VIEW_ID);
      vi.clearAllMocks();

      const evt = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      window.dispatchEvent(evt);
      await Promise.resolve();

      expect(mockMoveSelection).not.toHaveBeenCalled();
    });
  });

  it('existing open command still works after my-extensions is added', async () => {
    await createExtensionDefault.initialize(makeContext() as any);
    await createExtensionDefault.executeCommand('open');
    expect(mockNavigateToView).toHaveBeenCalledWith('create-extension/DefaultView');
  });

  it('existing build-with-ai command still works', async () => {
    await createExtensionDefault.initialize(makeContext() as any);
    await createExtensionDefault.executeCommand('build-with-ai');
    expect(mockNavigateToView).toHaveBeenCalledWith('create-extension/BuildProgressView');
  });
});
