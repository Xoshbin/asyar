/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  discoverExtensions: vi.fn(),
  setExtensionEnabled: vi.fn(),
  uninstallExtension: vi.fn(),
}));

vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    isExtensionEnabled: vi.fn().mockReturnValue(true),
    updateExtensionState: vi.fn().mockResolvedValue(true),
    removeExtensionState: vi.fn().mockResolvedValue(true),
    getSettings: vi.fn().mockReturnValue({}),
  },
}));

vi.mock('../log/logService', () => ({
  logService: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./viewManager.svelte', () => ({
  viewManager: {
    closeViewsForExtension: vi.fn(),
  },
}));

import { extensionStateManager } from './extensionStateManager.svelte';
import { discoverExtensions, setExtensionEnabled } from '../../lib/ipc/commands';
import { settingsService } from '../settings/settingsService.svelte';
import { viewManager } from './viewManager.svelte';
import { logService } from '../log/logService';
import type { ExtendedManifest } from '../../types/ExtendedManifest';

describe('extensionStateManager — needsRuntime', () => {
  beforeEach(() => {
    extensionStateManager.needsRuntime = [];
  });

  it('markNeedsRuntime adds the extension id', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });

  it('markNeedsRuntime dedupes repeated calls for the same id', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.markNeedsRuntime('ext.a');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });

  it('markNeedsRuntime tracks multiple distinct extensions', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.markNeedsRuntime('ext.b');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a', 'ext.b']);
  });

  it('clearNeedsRuntime removes the extension id', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.markNeedsRuntime('ext.b');
    extensionStateManager.clearNeedsRuntime('ext.a');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.b']);
  });

  it('clearNeedsRuntime on an id that was never marked is a no-op', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.clearNeedsRuntime('ext.never-marked');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });
});

describe('extensionStateManager — iconUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeRecord(id: string, icon?: string) {
    return {
      manifest: {
        id,
        name: id,
        description: '',
        type: 'extension' as const,
        version: '1.0.0',
        commands: [],
        ...(icon ? { icon } : {}),
      },
      enabled: true,
      isBuiltIn: false,
      compatibility: 'compatible' as const,
    };
  }

  it('keeps icon: prefix as-is', async () => {
    vi.mocked(discoverExtensions).mockResolvedValueOnce([
      makeRecord('calc', 'icon:calculator'),
    ] as never);
    const [ext] = await extensionStateManager.getAllExtensionsWithState();
    expect(ext.iconUrl).toBe('icon:calculator');
  });

  it('keeps emoji as-is instead of prefixing asyar-icon://', async () => {
    vi.mocked(discoverExtensions).mockResolvedValueOnce([makeRecord('play', '🧪')] as never);
    const [ext] = await extensionStateManager.getAllExtensionsWithState();
    expect(ext.iconUrl).toBe('🧪');
  });

  it('prefixes bare filename to asyar-extension://', async () => {
    vi.mocked(discoverExtensions).mockResolvedValueOnce([makeRecord('ext', 'icon.png')] as never);
    const [ext] = await extensionStateManager.getAllExtensionsWithState();
    expect(ext.iconUrl).toBe('asyar-extension://ext/icon.png');
  });

  it('keeps asyar-icon:// and https:// as-is', async () => {
    vi.mocked(discoverExtensions).mockResolvedValueOnce([
      makeRecord('a', 'asyar-icon://a/icon.png'),
      makeRecord('b', 'https://example.com/i.png'),
    ] as never);
    const result = await extensionStateManager.getAllExtensionsWithState();
    expect(result[0].iconUrl).toBe('asyar-icon://a/icon.png');
    expect(result[1].iconUrl).toBe('https://example.com/i.png');
  });

  it('returns undefined when icon is missing', async () => {
    vi.mocked(discoverExtensions).mockResolvedValueOnce([makeRecord('noicon')] as never);
    const [ext] = await extensionStateManager.getAllExtensionsWithState();
    expect(ext.iconUrl).toBeUndefined();
  });
});

describe('extensionStateManager — disableable lifecycle policy', () => {
  const reloadCallback = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    const manifests = new Map<string, ExtendedManifest>([
      [
        'calculator',
        {
          id: 'calculator',
          name: 'Calculator',
          description: '',
          version: '1.0.0',
          type: 'extension',
          lifecycle: { disableable: true },
          commands: [],
        } as ExtendedManifest,
      ],
      [
        'settings',
        {
          id: 'settings',
          name: 'Settings',
          description: '',
          version: '1.0.0',
          type: 'extension',
          lifecycle: { disableable: false },
          commands: [],
        } as ExtendedManifest,
      ],
      [
        'clipboard-history',
        {
          id: 'clipboard-history',
          name: 'Clipboard History',
          description: '',
          version: '1.0.0',
          type: 'extension',
          lifecycle: { disableable: true },
          commands: [],
        } as ExtendedManifest,
      ],
      [
        'file-search',
        {
          id: 'file-search',
          name: 'File Search',
          description: '',
          version: '1.0.0',
          type: 'extension',
          lifecycle: { disableable: true },
          commands: [],
        } as ExtendedManifest,
      ],
      [
        'notes',
        {
          id: 'notes',
          name: 'Notes',
          description: '',
          version: '1.0.0',
          type: 'extension',
          lifecycle: { disableable: true },
          commands: [],
        } as ExtendedManifest,
      ],
      [
        'runs',
        {
          id: 'runs',
          name: 'Runs',
          description: '',
          version: '1.0.0',
          type: 'extension',
          lifecycle: { disableable: true },
          commands: [],
        } as ExtendedManifest,
      ],
      [
        'snippets',
        {
          id: 'snippets',
          name: 'Snippets',
          description: '',
          version: '1.0.0',
          type: 'extension',
          lifecycle: { disableable: true },
          commands: [],
        } as ExtendedManifest,
      ],
      [
        'store',
        {
          id: 'store',
          name: 'Store',
          description: '',
          version: '1.0.0',
          type: 'extension',
          lifecycle: { disableable: true },
          commands: [],
        } as ExtendedManifest,
      ],
      [
        'walkthrough',
        {
          id: 'walkthrough',
          name: 'Walkthrough',
          description: '',
          version: '1.0.0',
          type: 'extension',
          lifecycle: { disableable: true },
          commands: [],
        } as ExtendedManifest,
      ],
      [
        'third-party',
        {
          id: 'third-party',
          name: 'Third Party',
          description: '',
          version: '1.0.0',
          type: 'extension',
          commands: [],
        } as ExtendedManifest,
      ],
    ]);
    extensionStateManager.init(manifests, reloadCallback);
  });

  describe('isExtensionDisableable', () => {
    it('reports optional built-in features as disableable', () => {
      expect(extensionStateManager.isExtensionDisableable('file-search')).toBe(true);
      expect(extensionStateManager.isExtensionDisableable('notes')).toBe(true);
      expect(extensionStateManager.isExtensionDisableable('runs')).toBe(true);
      expect(extensionStateManager.isExtensionDisableable('snippets')).toBe(true);
      expect(extensionStateManager.isExtensionDisableable('store')).toBe(true);
      expect(extensionStateManager.isExtensionDisableable('walkthrough')).toBe(true);
    });
  });

  describe('isExtensionEnabled', () => {
    it('always returns true for required built-ins even if settings says false', () => {
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(false);
      expect(extensionStateManager.isExtensionEnabled('settings')).toBe(true);
    });

    it('returns settingsService state for optional built-in (clipboard-history)', () => {
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(false);
      expect(extensionStateManager.isExtensionEnabled('clipboard-history')).toBe(false);

      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true);
      expect(extensionStateManager.isExtensionEnabled('clipboard-history')).toBe(true);
    });

    it('returns settingsService state for optional built-in (file-search)', () => {
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(false);
      expect(extensionStateManager.isExtensionEnabled('file-search')).toBe(false);

      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true);
      expect(extensionStateManager.isExtensionEnabled('file-search')).toBe(true);
    });

    it('returns settingsService state for optional built-in features (notes, runs, snippets, store, walkthrough)', () => {
      for (const id of ['notes', 'runs', 'snippets', 'store', 'walkthrough']) {
        vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(false);
        expect(extensionStateManager.isExtensionEnabled(id)).toBe(false);

        vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true);
        expect(extensionStateManager.isExtensionEnabled(id)).toBe(true);
      }
    });

    it('returns settingsService state for third-party extensions', () => {
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(false);
      expect(extensionStateManager.isExtensionEnabled('third-party')).toBe(false);

      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true);
      expect(extensionStateManager.isExtensionEnabled('third-party')).toBe(true);
    });
  });

  describe('toggleExtensionState', () => {
    it('rejects disabling required built-in features without calling IPC or changing state', async () => {
      const ok = await extensionStateManager.toggleExtensionState('settings', false);

      expect(ok).toBe(false);
      expect(setExtensionEnabled).not.toHaveBeenCalled();
      expect(settingsService.updateExtensionState).not.toHaveBeenCalled();
      expect(logService.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cannot disable required built-in feature: settings'),
      );
    });

    it('allows disabling migrated optional built-ins', async () => {
      vi.mocked(setExtensionEnabled).mockResolvedValue(true);

      const ok = await extensionStateManager.toggleExtensionState('calculator', false);

      expect(ok).toBe(true);
      expect(setExtensionEnabled).toHaveBeenCalledWith('calculator', false);
      expect(viewManager.closeViewsForExtension).toHaveBeenCalledWith('calculator');
    });

    it('allows disabling optional built-in features, closes active views, updates settings, and reloads', async () => {
      vi.mocked(setExtensionEnabled).mockResolvedValue(true);

      const ok = await extensionStateManager.toggleExtensionState('clipboard-history', false);

      expect(ok).toBe(true);
      expect(setExtensionEnabled).toHaveBeenCalledWith('clipboard-history', false);
      expect(settingsService.updateExtensionState).toHaveBeenCalledWith('clipboard-history', false);
      expect(viewManager.closeViewsForExtension).toHaveBeenCalledWith('clipboard-history');
      expect(reloadCallback).toHaveBeenCalledTimes(1);
    });

    it('allows disabling file-search, closes active views, updates settings, and reloads', async () => {
      vi.mocked(setExtensionEnabled).mockResolvedValue(true);

      const ok = await extensionStateManager.toggleExtensionState('file-search', false);

      expect(ok).toBe(true);
      expect(setExtensionEnabled).toHaveBeenCalledWith('file-search', false);
      expect(settingsService.updateExtensionState).toHaveBeenCalledWith('file-search', false);
      expect(viewManager.closeViewsForExtension).toHaveBeenCalledWith('file-search');
      expect(reloadCallback).toHaveBeenCalledTimes(1);
    });

    it('allows disabling notes, runs, snippets, store, and walkthrough', async () => {
      for (const id of ['notes', 'runs', 'snippets', 'store', 'walkthrough']) {
        vi.clearAllMocks();
        vi.mocked(setExtensionEnabled).mockResolvedValue(true);

        const ok = await extensionStateManager.toggleExtensionState(id, false);

        expect(ok).toBe(true);
        expect(setExtensionEnabled).toHaveBeenCalledWith(id, false);
        expect(settingsService.updateExtensionState).toHaveBeenCalledWith(id, false);
        expect(viewManager.closeViewsForExtension).toHaveBeenCalledWith(id);
        expect(reloadCallback).toHaveBeenCalledTimes(1);
      }
    });

    it('allows re-enabling optional built-in features and reloads', async () => {
      vi.mocked(setExtensionEnabled).mockResolvedValue(true);

      const ok = await extensionStateManager.toggleExtensionState('clipboard-history', true);

      expect(ok).toBe(true);
      expect(setExtensionEnabled).toHaveBeenCalledWith('clipboard-history', true);
      expect(settingsService.updateExtensionState).toHaveBeenCalledWith('clipboard-history', true);
      expect(reloadCallback).toHaveBeenCalledTimes(1);
    });

    it('allows re-enabling file-search and reloads', async () => {
      vi.mocked(setExtensionEnabled).mockResolvedValue(true);

      const ok = await extensionStateManager.toggleExtensionState('file-search', true);

      expect(ok).toBe(true);
      expect(setExtensionEnabled).toHaveBeenCalledWith('file-search', true);
      expect(settingsService.updateExtensionState).toHaveBeenCalledWith('file-search', true);
      expect(reloadCallback).toHaveBeenCalledTimes(1);
    });

    it('allows re-enabling notes, runs, snippets, store, and walkthrough', async () => {
      for (const id of ['notes', 'runs', 'snippets', 'store', 'walkthrough']) {
        vi.clearAllMocks();
        vi.mocked(setExtensionEnabled).mockResolvedValue(true);

        const ok = await extensionStateManager.toggleExtensionState(id, true);

        expect(ok).toBe(true);
        expect(setExtensionEnabled).toHaveBeenCalledWith(id, true);
        expect(settingsService.updateExtensionState).toHaveBeenCalledWith(id, true);
        expect(reloadCallback).toHaveBeenCalledTimes(1);
      }
    });

    it('serializes concurrent toggle calls sequentially', async () => {
      vi.mocked(setExtensionEnabled).mockResolvedValue(true);
      const executionOrder: string[] = [];

      reloadCallback.mockImplementation(async () => {
        executionOrder.push('reload');
      });

      const p1 = extensionStateManager.toggleExtensionState('clipboard-history', false);
      const p2 = extensionStateManager.toggleExtensionState('clipboard-history', true);

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1).toBe(true);
      expect(res2).toBe(true);
      expect(executionOrder).toEqual(['reload', 'reload']);
    });
  });

  describe('getAllExtensions', () => {
    it('omits disabled optional built-in features from returned extension items', async () => {
      vi.mocked(settingsService.isExtensionEnabled).mockImplementation(
        (id) => id !== 'clipboard-history',
      );

      const items = await extensionStateManager.getAllExtensions(vi.fn());
      const ids = items.map((i) => i.title);

      expect(ids).toContain('Calculator');
      expect(ids).not.toContain('Clipboard History');
    });

    it('includes enabled optional built-in features in returned extension items', async () => {
      vi.mocked(settingsService.isExtensionEnabled).mockReturnValue(true);

      const items = await extensionStateManager.getAllExtensions(vi.fn());
      const ids = items.map((i) => i.title);

      expect(ids).toContain('Calculator');
      expect(ids).toContain('Clipboard History');
    });
  });

  describe('getAllExtensionsWithState', () => {
    it('passes disableable flag through to extension item data', async () => {
      vi.mocked(discoverExtensions).mockResolvedValueOnce([
        {
          manifest: { id: 'calc', name: 'Calc', commands: [] },
          enabled: true,
          isBuiltIn: true,
          disableable: false,
        },
        {
          manifest: { id: 'clipboard-history', name: 'Clipboard History', commands: [] },
          enabled: true,
          isBuiltIn: true,
          disableable: true,
        },
      ] as never);

      const items = await extensionStateManager.getAllExtensionsWithState();
      expect(items[0].disableable).toBe(false);
      expect(items[1].disableable).toBe(true);
    });
  });
});
