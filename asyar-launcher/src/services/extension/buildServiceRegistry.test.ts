import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NAMESPACES } from 'asyar-sdk/contracts';

// Mock all service dependencies BEFORE importing the module under test
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), custom: vi.fn() },
}));
vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn().mockReturnValue({ search: {} }),
    updateSettings: vi.fn(),
    isExtensionEnabled: vi.fn().mockReturnValue(true),
  },
}));
vi.mock('../notification/notificationService', () => ({
  notificationService: {},
}));
vi.mock('../clipboard/clipboardHistoryService', () => ({
  clipboardHistoryService: {},
}));
vi.mock('./commandService.svelte', () => ({
  commandService: { commands: new Map(), registerCommand: vi.fn(), executeCommand: vi.fn() },
}));
vi.mock('../action/actionService.svelte', () => ({
  actionService: {},
}));
vi.mock('../statusBar/statusBarService.svelte', () => ({
  statusBarService: {},
}));
vi.mock('../search/searchBarAccessoryService.svelte', () => ({
  searchBarAccessoryService: {
    set: vi.fn(),
    clearForExtension: vi.fn(),
  },
}));
vi.mock('../auth/entitlementService.svelte', () => ({
  entitlementService: { check: vi.fn(), getAll: vi.fn() },
}));
vi.mock('../storage/extensionStorageService', () => ({
  extensionStorageService: {},
}));
vi.mock('./extensionPreferencesService.svelte', () => ({
  extensionPreferencesService: {
    getEffectivePreferences: vi.fn(),
    set: vi.fn(),
    reset: vi.fn(),
  },
}));
vi.mock('../storage/extensionCacheService', () => ({
  extensionCacheService: {},
}));
vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: {},
}));
vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: {},
}));
vi.mock('../selection/selectionService', () => ({
  selectionService: {},
}));
vi.mock('../ai/aiService.svelte', () => ({
  aiExtensionService: {},
}));
vi.mock('../oauth/extensionOAuthService.svelte', () => ({
  extensionOAuthService: {},
}));
vi.mock('../shell/shellService.svelte', () => ({
  shellService: {},
}));
vi.mock('../fileManager/fileManagerService', () => ({
  fileManagerService: {},
}));
vi.mock('../interop/interopService.svelte', () => ({
  InteropService: vi.fn().mockImplementation(function () {}),
}));
vi.mock('../application/applicationService', () => ({
  applicationService: {},
}));
vi.mock('../windowManagement/windowManagementService', () => ({
  windowManagementService: {},
}));
vi.mock('../opener/openerService', () => ({
  openerService: {},
}));
vi.mock('../network/networkService', () => ({
  networkService: {},
}));
vi.mock('../systemEvents/systemEventsService', () => ({
  systemEventsService: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));
vi.mock('../appEvents/appEventsService', () => ({
  appEventsService: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));
vi.mock('../power/powerService', () => ({
  powerService: { keepAwake: vi.fn(), release: vi.fn(), list: vi.fn() },
}));
vi.mock('../run/runService.svelte', () => ({
  runService: {},
}));

// Mock the IPC commands used by the real tools implementation (Item 7).
// These mocks must be defined BEFORE buildServiceRegistry is imported.
const mockAgentsToolsRegisterTier2 = vi.fn().mockResolvedValue(undefined);
const mockAgentsToolsList = vi.fn().mockResolvedValue([]);
vi.mock('../../lib/ipc/commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/ipc/commands')>();
  return {
    ...original,
    agentsToolsRegisterTier2: (...args: unknown[]) => mockAgentsToolsRegisterTier2(...args),
    agentsToolsList: (...args: unknown[]) => mockAgentsToolsList(...args),
  };
});

import { buildServiceRegistry } from './buildServiceRegistry';

describe('buildServiceRegistry', () => {
  it('returns a registry with every NAMESPACES key present', () => {
    const mockExtensionManager = {} as any;
    const mockGetManifestById = vi.fn();
    const mockHandleCommandAction = vi.fn();

    const registry = buildServiceRegistry({
      extensionManager: mockExtensionManager,
      getManifestById: mockGetManifestById,
      handleCommandAction: mockHandleCommandAction,
    });

    const registryKeys = Object.keys(registry);
    for (const ns of NAMESPACES) {
      expect(registryKeys, `Missing namespace: ${ns}`).toContain(ns);
    }
    expect(registryKeys.length).toBe(NAMESPACES.length);
  });

  it('uses the provided extensionManager as the "extensions" entry', () => {
    const mockExtensionManager = { id: 'mock-em' } as any;

    const registry = buildServiceRegistry({
      extensionManager: mockExtensionManager,
      getManifestById: vi.fn(),
      handleCommandAction: vi.fn(),
    });

    expect(registry.extensions).toBe(mockExtensionManager);
  });
});

// ── Item 7: tools service entry in registry ───────────────────────────────────

function makeRegistry() {
  return buildServiceRegistry({
    extensionManager: {} as any,
    getManifestById: vi.fn(),
    handleCommandAction: vi.fn(),
  });
}

const sampleTool = {
  id: 'a',
  name: 'Tool A',
  description: 'Does A',
  parameters: { type: 'object', properties: {} },
};

describe('buildServiceRegistry tools entry — Item 7', () => {
  beforeEach(() => {
    mockAgentsToolsRegisterTier2.mockClear();
    mockAgentsToolsList.mockClear();
  });

  it('tools.registerTool calls agentsToolsRegisterTier2 with the current tool set', async () => {
    const registry = makeRegistry();

    await registry.tools.registerTool('ext.foo', sampleTool);

    expect(mockAgentsToolsRegisterTier2).toHaveBeenCalledWith(
      'ext.foo',
      expect.arrayContaining([expect.objectContaining({ id: 'a' })]),
    );
  });

  it('tools.registerTool accumulates tools per extension across calls', async () => {
    const registry = makeRegistry();
    const toolB = { id: 'b', name: 'Tool B', description: 'Does B', parameters: {} };

    await registry.tools.registerTool('ext.foo', sampleTool);
    await registry.tools.registerTool('ext.foo', toolB);

    // Second call must pass both tools.
    const lastCall = mockAgentsToolsRegisterTier2.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toBe('ext.foo');
    const toolIds = (lastCall![1] as { id: string }[]).map((t) => t.id);
    expect(toolIds).toContain('a');
    expect(toolIds).toContain('b');
  });

  it('tools.unregisterTool removes only the specified tool from the set', async () => {
    const registry = makeRegistry();
    const toolB = { id: 'b', name: 'Tool B', description: 'Does B', parameters: {} };

    await registry.tools.registerTool('ext.foo', sampleTool);
    await registry.tools.registerTool('ext.foo', toolB);
    mockAgentsToolsRegisterTier2.mockClear();

    await registry.tools.unregisterTool('ext.foo', 'a');

    expect(mockAgentsToolsRegisterTier2).toHaveBeenCalled();
    const lastCall = mockAgentsToolsRegisterTier2.mock.calls.at(-1);
    const toolIds = (lastCall![1] as { id: string }[]).map((t) => t.id);
    expect(toolIds).not.toContain('a');
    expect(toolIds).toContain('b');
  });

  it('tools.listTools forwards to agentsToolsList and returns the result', async () => {
    const descriptor = {
      id: 'echo',
      name: 'Echo',
      description: 'Echoes',
      parameters: {},
      source: { kind: 'builtin' },
      fullyQualifiedId: 'builtin:echo',
    };
    mockAgentsToolsList.mockResolvedValueOnce([descriptor]);

    const registry = makeRegistry();
    const result = await registry.tools.listTools();

    expect(mockAgentsToolsList).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('echo');
  });
});
