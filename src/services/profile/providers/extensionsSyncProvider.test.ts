import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionsSyncProvider } from './extensionsSyncProvider';
import type { SyncProviderData } from '../types';

const mockExtensions = [
  { id: 'ext1', title: 'Ext One', version: '1.0', isBuiltIn: false, enabled: true },
  { id: 'ext2', title: 'Ext Two', version: '2.0', isBuiltIn: true, enabled: true },
];

vi.mock('../../extension/extensionStateManager.svelte', () => ({
  extensionStateManager: {
    getAllExtensionsWithState: vi.fn().mockResolvedValue([
      { id: 'ext1', title: 'Ext One', version: '1.0', isBuiltIn: false, enabled: true },
      { id: 'ext2', title: 'Ext Two', version: '2.0', isBuiltIn: true, enabled: true },
    ]),
  },
}));

vi.mock('../../settings/settingsService.svelte', () => {
  const subscribers = new Set<() => void>();
  const settings = {
    extensions: { enabled: { ext1: true } as Record<string, boolean> },
  };
  return {
    settingsService: {
      updateSettings: vi.fn().mockResolvedValue(true),
      currentSettings: settings,
      subscribe: vi.fn((cb: () => void) => {
        subscribers.add(cb);
        cb(); // prime
        return () => subscribers.delete(cb);
      }),
      __emit: () => subscribers.forEach((cb) => cb()),
    },
  };
});

describe('ExtensionsSyncProvider', () => {
  let provider: ExtensionsSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ExtensionsSyncProvider();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('extensions');
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('replace');
    expect(provider.sensitiveFields).toEqual([]);
  });

  it('exportFull returns only user-installed extensions (excludes built-ins)', async () => {
    const result = await provider.exportFull();
    expect(result.providerId).toBe('extensions');
    expect(result.version).toBe(1);
    const data = result.data as { installed: any[]; enabledStates: Record<string, boolean> };
    expect(data.installed.length).toBe(1);
    expect(data.installed[0].id).toBe('ext1');
    expect(data.enabledStates['ext1']).toBe(true);
    expect(data.enabledStates['ext2']).toBeUndefined(); // built-in excluded
    expect(result.binaryAssets).toBeUndefined();
  });

  it('preview counts only user-installed extensions', async () => {
    const incoming: SyncProviderData = {
      providerId: 'extensions',
      version: 1,
      exportedAt: Date.now(),
      data: {
        installed: [...mockExtensions], // includes one built-in — should be filtered
        enabledStates: { ext1: true },
      },
    };

    const preview = await provider.preview(incoming);
    expect(preview.incomingCount).toBe(1); // only ext1 (non-built-in)
    expect(preview.localCount).toBe(1);    // only ext1 from mock
  });

  it('applyImport replace — updates enabled states and warns about missing extensions', async () => {
    const { settingsService } = await import('../../settings/settingsService.svelte');
    const { extensionStateManager } = await import('../../extension/extensionStateManager.svelte');

    // Simulate that ext3 (non-built-in) from incoming is not currently installed
    (extensionStateManager.getAllExtensionsWithState as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'ext2', title: 'Ext Two', version: '2.0', isBuiltIn: true, enabled: true },
    ]);

    const incoming: SyncProviderData = {
      providerId: 'extensions',
      version: 1,
      exportedAt: Date.now(),
      data: {
        installed: [
          { id: 'ext1', title: 'Ext One', version: '1.0', isBuiltIn: false, enabled: true },
          { id: 'ext2', title: 'Ext Two', version: '2.0', isBuiltIn: true, enabled: true },
        ],
        enabledStates: { ext1: true, ext2: true },
      },
    };

    const result = await provider.applyImport(incoming, 'replace');
    expect(result.success).toBe(true);
    expect(settingsService.updateSettings).toHaveBeenCalledWith('extensions', { enabled: { ext1: true, ext2: true } });
    expect(result.itemsUpdated).toBe(2);
    // ext1 is not in currentIds and is not built-in → should warn
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('Ext One');
  });

  it('applyImport skip — does nothing', async () => {
    const { settingsService } = await import('../../settings/settingsService.svelte');
    const incoming: SyncProviderData = {
      providerId: 'extensions',
      version: 1,
      exportedAt: Date.now(),
      data: {
        installed: [...mockExtensions],
        enabledStates: { ext1: false, ext2: true },
      },
    };

    const result = await provider.applyImport(incoming, 'skip');
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
    expect(result.itemsAdded).toBe(0);
    expect(result.itemsUpdated).toBe(0);
  });

  describe('exportItems returns one SyncItem per user-installed extension', () => {
    it('one entry per non-built-in extension keyed by extensionId', async () => {
      const items = await provider.exportItems();
      expect(items.length).toBe(1);
      expect(items[0].id).toBe('ext1');
      expect(items[0].categoryId).toBe('extensions');
    });
  });

  describe('applyItemUpsert merges the enabled state into settings', () => {
    it('writes a single-key extensions.enabled patch', async () => {
      const { settingsService } = await import('../../settings/settingsService.svelte');
      await provider.applyItemUpsert({
        id: 'ext1',
        categoryId: 'extensions',
        content: { id: 'ext1', title: 'Ext One', version: '1.0', isBuiltIn: false, enabled: false },
      });
      // The implementation merges with current state, so the call should
      // include both ext1's new state and any other already-enabled keys.
      expect(settingsService.updateSettings).toHaveBeenCalledWith(
        'extensions',
        expect.objectContaining({ enabled: expect.objectContaining({ ext1: false }) })
      );
    });
  });

  describe('applyItemDelete removes the extension from enabled states', () => {
    it('writes the extensions.enabled map without the deleted id', async () => {
      const { settingsService } = await import('../../settings/settingsService.svelte');
      await provider.applyItemDelete('ext1');
      const lastCall = (settingsService.updateSettings as ReturnType<typeof vi.fn>).mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('extensions');
      const enabled = (lastCall?.[1] as { enabled: Record<string, boolean> }).enabled;
      expect(enabled).not.toHaveProperty('ext1');
    });
  });

  describe('subscribeToChanges emits when settings change', () => {
    it('fires upsert on settingsService emit', async () => {
      const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
      const unsub = provider.subscribeToChanges((ev) => events.push(ev));

      const { settingsService } = await import('../../settings/settingsService.svelte');
      (settingsService as unknown as { __emit: () => void }).__emit();

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('upsert');
      expect(events[0].categoryId).toBe('extensions');
      // Lock the '*' sentinel contract — settingsService.subscribe doesn't
      // tell us which extension's enabled flag flipped, so the provider
      // emits the wildcard. cloudSyncService is expected to re-export and
      // diff against the journal.
      expect(events[0].itemId).toBe('*');
      unsub();
    });
  });
});
