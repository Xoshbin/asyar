import { describe, it, expect, vi } from 'vitest';
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
