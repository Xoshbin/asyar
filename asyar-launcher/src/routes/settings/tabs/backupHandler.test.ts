import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetProviders = vi.hoisted(() => vi.fn());
const mockGetProviderById = vi.hoisted(() => vi.fn());
const mockCollectExportData = vi.hoisted(() => vi.fn());
const mockBuildManifest = vi.hoisted(() => vi.fn());

vi.mock('../../../services/profile/profileService', () => ({
  profileService: {
    getProviders: mockGetProviders,
    getProviderById: mockGetProviderById,
    collectExportData: mockCollectExportData,
    buildManifest: mockBuildManifest,
  },
}));

vi.mock('../../../lib/ipc/commands', () => ({
  showSaveProfileDialog: vi.fn(),
  showOpenProfileDialog: vi.fn(),
  exportProfile: vi.fn(),
  importProfile: vi.fn(),
}));

vi.mock('../../../services/log/logService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('0.1.0'),
}));

import { BackupHandler } from './backupHandler.svelte';
import * as commands from '../../../lib/ipc/commands';

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'snippets',
    displayName: 'Snippets',
    icon: '',
    syncTier: 'core' as const,
    defaultEnabled: true,
    defaultConflictStrategy: 'merge' as const,
    sensitiveFields: [] as string[],
    exportFull: vi.fn().mockResolvedValue({ providerId: 'snippets', version: 1, exportedAt: 0, data: [] }),
    exportForSync: vi.fn().mockResolvedValue({ providerId: 'snippets', version: 1, exportedAt: 0, data: [] }),
    preview: vi.fn().mockResolvedValue({ localCount: 3, incomingCount: 2, conflicts: 0, newItems: 2, removedItems: 1 }),
    applyImport: vi.fn().mockResolvedValue({ success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] }),
    getLocalSummary: vi.fn().mockResolvedValue({ itemCount: 5, label: '5 snippets' }),
    ...overrides,
  };
}

describe('BackupHandler', () => {
  let handler: BackupHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviders.mockReturnValue([makeProvider()]);
    mockGetProviderById.mockReturnValue(makeProvider());
    handler = new BackupHandler();
  });

  describe('init()', () => {
    it('loads providers and enables defaultEnabled ones', async () => {
      await handler.init();
      expect(handler.providers).toHaveLength(1);
      expect(handler.enabledCategories.has('snippets')).toBe(true);
    });

    it('does not enable providers with defaultEnabled: false', async () => {
      mockGetProviders.mockReturnValue([
        makeProvider({ id: 'ai-conversations', defaultEnabled: false }),
      ]);
      handler = new BackupHandler();
      await handler.init();
      expect(handler.enabledCategories.has('ai-conversations')).toBe(false);
    });

    it('fetches local summaries for each provider', async () => {
      await handler.init();
      expect(handler.localSummaries.get('snippets')?.label).toBe('5 snippets');
    });
  });

  describe('hasSensitiveData', () => {
    it('returns true when a checked provider has sensitiveFields', async () => {
      mockGetProviders.mockReturnValue([makeProvider({ sensitiveFields: ['apiKey'] })]);
      handler = new BackupHandler();
      await handler.init();
      expect(handler.hasSensitiveData).toBe(true);
    });

    it('returns false when the sensitive provider is unchecked', async () => {
      mockGetProviders.mockReturnValue([makeProvider({ sensitiveFields: ['apiKey'] })]);
      handler = new BackupHandler();
      await handler.init();
      handler.toggleCategory('snippets');
      expect(handler.hasSensitiveData).toBe(false);
    });
  });

  describe('toggleCategory()', () => {
    it('removes an enabled category', async () => {
      await handler.init();
      handler.toggleCategory('snippets');
      expect(handler.enabledCategories.has('snippets')).toBe(false);
    });

    it('adds a disabled category', async () => {
      mockGetProviders.mockReturnValue([makeProvider({ defaultEnabled: false })]);
      handler = new BackupHandler();
      await handler.init();
      handler.toggleCategory('snippets');
      expect(handler.enabledCategories.has('snippets')).toBe(true);
    });
  });

  describe('handleExport()', () => {
    const mockExportData = new Map([
      ['snippets', { providerId: 'snippets', version: 1, exportedAt: 0, data: [] }],
    ]);
    const mockManifest = {
      formatVersion: 1,
      appVersion: '',
      exportedAt: 0,
      platform: '',
      hostname: '',
      encryptionScheme: null,
      encryptionSalt: null,
      hasSensitiveData: false,
      categories: [{
        id: 'snippets',
        displayName: 'Snippets',
        file: 'snippets.json',
        providerVersion: 1,
        itemCount: 0,
        syncTier: 'core',
        hasSensitiveFields: false,
      }],
    };

    beforeEach(() => {
      vi.mocked(commands.showSaveProfileDialog).mockResolvedValue('/path/backup.asyar');
      mockCollectExportData.mockResolvedValue(mockExportData);
      mockBuildManifest.mockReturnValue(mockManifest);
      vi.mocked(commands.exportProfile).mockResolvedValue('/path/backup.asyar');
    });

    it('calls showSaveProfileDialog then exportProfile and sets success status', async () => {
      await handler.init();
      await handler.handleExport();
      expect(commands.showSaveProfileDialog).toHaveBeenCalledWith('asyar-backup.asyar');
      expect(commands.exportProfile).toHaveBeenCalled();
      expect(handler.exportStatus).toBe('success');
      expect(handler.exportMessage).toBe('Backup saved successfully.');
    });

    it('does nothing when save dialog is cancelled', async () => {
      vi.mocked(commands.showSaveProfileDialog).mockResolvedValue(null);
      await handler.init();
      await handler.handleExport();
      expect(commands.exportProfile).not.toHaveBeenCalled();
      expect(handler.exportStatus).toBe('idle');
    });

    it('sets exportStatus to error when exportProfile throws', async () => {
      vi.mocked(commands.exportProfile).mockRejectedValue(new Error('disk full'));
      await handler.init();
      await handler.handleExport();
      expect(handler.exportStatus).toBe('error');
      expect(handler.exportMessage).toContain('disk full');
    });
  });
});
