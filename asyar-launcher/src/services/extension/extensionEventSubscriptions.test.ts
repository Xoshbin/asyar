import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), custom: vi.fn() },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('./extensionPreferencesService.svelte', () => ({
  extensionPreferencesService: {
    invalidateCache: vi.fn(),
    getEffectivePreferences: vi.fn().mockResolvedValue({
      extension: {},
      commands: {},
    }),
  },
}));

vi.mock('./extensionDiscovery', () => ({
  isBuiltInFeature: vi.fn().mockReturnValue(false),
}));

vi.mock('./extensionIframeManager.svelte', () => ({
  extensionIframeManager: {
    sendPreferencesToExtension: vi.fn(),
  },
}));

import { listen } from '@tauri-apps/api/event';
import { ExtensionEventSubscriptions } from './extensionEventSubscriptions';
import { extensionPreferencesService } from './extensionPreferencesService.svelte';
import { isBuiltInFeature } from './extensionDiscovery';
import { extensionIframeManager } from './extensionIframeManager.svelte';

describe('ExtensionEventSubscriptions', () => {
  let subs: ExtensionEventSubscriptions;
  let deps: {
    isExtensionEnabled: ReturnType<typeof vi.fn>;
    executeCommand: ReturnType<typeof vi.fn>;
    reloadExtensions: ReturnType<typeof vi.fn>;
    getManifestById: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    subs = new ExtensionEventSubscriptions();
    deps = {
      isExtensionEnabled: vi.fn().mockReturnValue(true),
      executeCommand: vi.fn().mockResolvedValue(undefined),
      reloadExtensions: vi.fn().mockResolvedValue(undefined),
      getManifestById: vi.fn().mockReturnValue({ id: 'test-ext' }),
    };
  });

  describe('subscribe', () => {
    it('registers both Tauri event listeners', async () => {
      const unlistenSpy = vi.fn();
      vi.mocked(listen).mockResolvedValue(unlistenSpy);

      await subs.subscribe(deps);

      expect(listen).toHaveBeenCalledTimes(2);
      expect(listen).toHaveBeenCalledWith('asyar:scheduler:tick', expect.any(Function));
      expect(listen).toHaveBeenCalledWith('asyar:preferences-changed', expect.any(Function));
    });
  });

  describe('unsubscribe', () => {
    it('calls both unlisten functions', async () => {
      const unlistenScheduler = vi.fn();
      const unlistenPreferences = vi.fn();
      vi.mocked(listen)
        .mockResolvedValueOnce(unlistenScheduler)
        .mockResolvedValueOnce(unlistenPreferences);

      await subs.subscribe(deps);
      subs.unsubscribe();

      expect(unlistenScheduler).toHaveBeenCalledOnce();
      expect(unlistenPreferences).toHaveBeenCalledOnce();
    });

    it('is safe to call when not subscribed', () => {
      expect(() => subs.unsubscribe()).not.toThrow();
    });
  });

  describe('scheduler tick handler', () => {
    it('calls executeCommand with correct objectId for enabled extension', async () => {
      let capturedHandler: ((event: any) => void) | undefined;
      vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
        if (eventName === 'asyar:scheduler:tick') capturedHandler = handler;
        return vi.fn();
      });

      await subs.subscribe(deps);
      expect(capturedHandler).toBeDefined();

      await capturedHandler!({ payload: { extensionId: 'com.test', commandId: 'refresh' } });

      expect(deps.executeCommand).toHaveBeenCalledWith(
        'cmd_com.test_refresh',
        { scheduledTick: true },
      );
    });

    it('skips disabled extensions', async () => {
      let capturedHandler: ((event: any) => void) | undefined;
      vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
        if (eventName === 'asyar:scheduler:tick') capturedHandler = handler;
        return vi.fn();
      });
      deps.isExtensionEnabled.mockReturnValue(false);

      await subs.subscribe(deps);
      await capturedHandler!({ payload: { extensionId: 'disabled', commandId: 'cmd' } });

      expect(deps.executeCommand).not.toHaveBeenCalled();
    });

    it('catches and logs errors without throwing', async () => {
      let capturedHandler: ((event: any) => void) | undefined;
      vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
        if (eventName === 'asyar:scheduler:tick') capturedHandler = handler;
        return vi.fn();
      });
      deps.executeCommand.mockRejectedValueOnce(new Error('fail'));

      await subs.subscribe(deps);
      await expect(capturedHandler!({ payload: { extensionId: 'x', commandId: 'c' } })).resolves.not.toThrow();
    });
  });

  describe('preferences-changed handler', () => {
    it('invalidates cache and reloads built-in extensions on preference change', async () => {
      let capturedHandler: ((event: any) => void) | undefined;
      vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
        if (eventName === 'asyar:preferences-changed') capturedHandler = handler;
        return vi.fn();
      });
      vi.mocked(isBuiltInFeature).mockReturnValue(true);

      await subs.subscribe(deps);
      await capturedHandler!({ payload: { extensionId: 'calculator' } });

      expect(extensionPreferencesService.invalidateCache).toHaveBeenCalledWith('calculator');
      expect(deps.reloadExtensions).toHaveBeenCalled();
    });

    it('sends preferences to iframe for Tier 2 extensions', async () => {
      let capturedHandler: ((event: any) => void) | undefined;
      vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
        if (eventName === 'asyar:preferences-changed') capturedHandler = handler;
        return vi.fn();
      });
      vi.mocked(isBuiltInFeature).mockReturnValue(false);

      await subs.subscribe(deps);
      await capturedHandler!({ payload: { extensionId: 'tier2-ext' } });

      expect(extensionPreferencesService.invalidateCache).toHaveBeenCalledWith('tier2-ext');
      expect(extensionIframeManager.sendPreferencesToExtension).toHaveBeenCalledWith(
        'tier2-ext',
        { extension: {}, commands: {} },
      );
      expect(deps.reloadExtensions).not.toHaveBeenCalled();
    });

    it('ignores events with no extensionId', async () => {
      let capturedHandler: ((event: any) => void) | undefined;
      vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
        if (eventName === 'asyar:preferences-changed') capturedHandler = handler;
        return vi.fn();
      });

      await subs.subscribe(deps);
      await capturedHandler!({ payload: {} });

      expect(extensionPreferencesService.invalidateCache).not.toHaveBeenCalled();
    });

    it('ignores events for unknown extensions (no manifest)', async () => {
      let capturedHandler: ((event: any) => void) | undefined;
      vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
        if (eventName === 'asyar:preferences-changed') capturedHandler = handler;
        return vi.fn();
      });
      deps.getManifestById.mockReturnValue(undefined);

      await subs.subscribe(deps);
      await capturedHandler!({ payload: { extensionId: 'unknown' } });

      expect(extensionPreferencesService.invalidateCache).toHaveBeenCalledWith('unknown');
      // But no reload or iframe send should happen
      expect(deps.reloadExtensions).not.toHaveBeenCalled();
      expect(extensionIframeManager.sendPreferencesToExtension).not.toHaveBeenCalled();
    });
  });
});
