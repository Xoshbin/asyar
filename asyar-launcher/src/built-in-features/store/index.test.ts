/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/envService', () => ({
  envService: { storeApiBaseUrl: 'https://store.example.com' },
}));

vi.mock('../../lib/ipc/commands', () => ({
  listInstalledExtensions: vi.fn().mockResolvedValue([]),
  installExtensionFromUrl: vi.fn().mockResolvedValue(undefined),
  uninstallExtension: vi.fn().mockResolvedValue(undefined),
  checkExtensionConsent: vi.fn().mockResolvedValue(undefined),
  setExtensionConsent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
    executeAction: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/extension/extensionUpdateService.svelte', () => ({
  extensionUpdateService: {
    hasUpdates: false,
    availableUpdates: [],
    checkForUpdates: vi.fn().mockResolvedValue([]),
    getUpdateForExtension: vi.fn().mockReturnValue(null),
    updateSingle: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../services/extension/permissionConsentService.svelte', () => ({
  permissionConsentService: {
    requestConsent: vi.fn().mockResolvedValue(true),
    ensureConsent: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../lib/filterCompatibleExtensions', () => ({
  filterCompatibleExtensions: vi.fn(async (exts) => exts),
}));

vi.mock('../../components/base/Modal.logic', () => ({
  isAnyModalOpen: vi.fn(() => false),
}));

vi.mock('../../services/extension/extensionStateManager.svelte', () => ({
  extensionStateManager: {
    markNeedsRuntime: vi.fn(),
  },
}));

vi.mock('../../services/extension/runtimeDownloads', () => ({
  downloadDeclaredRuntimes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/ipc/runtimeCommands', () => ({
  getRuntimeDownloadSizes: vi.fn().mockResolvedValue([]),
}));

vi.mock('./DefaultView.svelte', () => ({ default: {} }));
vi.mock('./DetailView.svelte', () => ({ default: {} }));
vi.mock('./LazyDetailView.svelte', () => ({ default: {} }));

import { actionService } from '../../services/action/actionService.svelte';
import { permissionConsentService } from '../../services/extension/permissionConsentService.svelte';
import storeExtension from './index.svelte';
import { initializeStore } from './state.svelte';

const mockLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeContext(manager: object) {
  return {
    getService: <T>(name: string): T => {
      if (name === 'log') return mockLog as unknown as T;
      return manager as unknown as T;
    },
  };
}

describe('StoreExtension lifecycle and commands', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
    const ctx = makeContext({
      navigateToView: vi.fn(),
      setActiveViewActionLabel: vi.fn(),
    });
    await storeExtension.initialize(ctx as never);
  });

  it('executeCommand("browse") navigates to store/DefaultView', async () => {
    const navigateToView = vi.fn();
    const ctx = makeContext({ navigateToView });
    await storeExtension.initialize(ctx as never);

    const result = await storeExtension.executeCommand('browse');
    expect(navigateToView).toHaveBeenCalledWith('store/DefaultView');
    expect(result).toEqual({ success: true });
  });

  it('activate() initializes the store', async () => {
    await storeExtension.activate();
    expect(initializeStore()).toBeDefined();
  });

  it('deactivate() cleans up keydown listener, unregisters actions, and clears view label', async () => {
    const setActiveViewActionLabel = vi.fn();
    const navigateToView = vi.fn();
    const ctx = makeContext({ setActiveViewActionLabel, navigateToView });
    await storeExtension.initialize(ctx as never);

    await storeExtension.viewActivated('store/DefaultView');
    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);

    await storeExtension.deactivate();

    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(actionService.unregisterAction).toHaveBeenCalledWith('app.asyar.store:install-detail');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('app.asyar.store:uninstall-detail');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('app.asyar.store:update-detail');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('app.asyar.store:install-selected');
    expect(actionService.unregisterAction).toHaveBeenCalledWith(
      'app.asyar.store:uninstall-selected',
    );
    expect(actionService.unregisterAction).toHaveBeenCalledWith('app.asyar.store:update-selected');
    expect(setActiveViewActionLabel).toHaveBeenCalledWith(null);
  });

  it('deactivate() is safe and idempotent when not in view', async () => {
    await storeExtension.deactivate();
    expect(actionService.unregisterAction).toHaveBeenCalledWith('app.asyar.store:install-detail');
  });

  it('uses caller-supplied listing metadata for consent before downloading', async () => {
    vi.mocked(permissionConsentService.requestConsent).mockResolvedValueOnce(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await storeExtension.installExtension('files', 42, 'Files', {
      id: 42,
      name: 'Files',
      slug: 'files',
      description: '',
      category: 'productivity',
      status: 'published',
      author: { id: 1, name: 'Asyar' },
      manifest: { permissions: ['fs:read'] },
    });

    expect(permissionConsentService.requestConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: '42',
        extensionName: 'Files',
        reason: 'install',
        permissions: ['fs:read'],
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
