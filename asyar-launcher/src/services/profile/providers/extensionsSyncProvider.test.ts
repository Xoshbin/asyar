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

vi.mock('../../settings/settingsService.svelte', () => ({
  settingsService: {
    updateSettings: vi.fn().mockResolvedValue(true),
  },
}));

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

  it('exportFull returns installed extensions and enabled states', async () => {
    const result = await provider.exportFull();
    expect(result.providerId).toBe('extensions');
    expect(result.version).toBe(1);
    const data = result.data as { installed: any[]; enabledStates: Record<string, boolean> };
    expect(data.installed.length).toBe(2);
    expect(data.enabledStates['ext1']).toBe(true);
    expect(data.enabledStates['ext2']).toBe(true);
    expect(result.binaryAssets).toBeUndefined();
  });

  it('preview returns installed count', async () => {
    const incoming: SyncProviderData = {
      providerId: 'extensions',
      version: 1,
      exportedAt: Date.now(),
      data: {
        installed: [...mockExtensions],
        enabledStates: { ext1: true, ext2: true },
      },
    };

    const preview = await provider.preview(incoming);
    expect(preview.incomingCount).toBe(2);
    expect(preview.localCount).toBe(2);
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
});
