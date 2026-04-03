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

  describe('handleChooseFile()', () => {
    const unencryptedContents = {
      manifest_json: JSON.stringify({
        formatVersion: 1,
        appVersion: '0.1.0',
        exportedAt: 1000,
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
          itemCount: 3,
          syncTier: 'core',
          hasSensitiveFields: false,
        }],
      }),
      category_files: { 'snippets.json': JSON.stringify({ providerId: 'snippets', version: 1, exportedAt: 0, data: [] }) },
      asset_paths: [],
    };

    const encryptedContents = {
      ...unencryptedContents,
      manifest_json: unencryptedContents.manifest_json.replace(
        '"encryptionScheme":null',
        '"encryptionScheme":"aes-256-gcm"',
      ),
    };

    beforeEach(() => {
      vi.mocked(commands.showOpenProfileDialog).mockResolvedValue('/path/backup.asyar');
      vi.mocked(commands.importProfile).mockResolvedValue(unencryptedContents);
      mockGetProviderById.mockReturnValue(makeProvider());
    });

    it('does nothing when file dialog is cancelled', async () => {
      vi.mocked(commands.showOpenProfileDialog).mockResolvedValue(null);
      await handler.init();
      await handler.handleChooseFile();
      expect(commands.importProfile).not.toHaveBeenCalled();
      expect(handler.importModalOpen).toBe(false);
    });

    it('populates importCategories and opens modal for unencrypted archive', async () => {
      await handler.init();
      await handler.handleChooseFile();
      expect(handler.importModalOpen).toBe(true);
      expect(handler.importCategories.has('snippets')).toBe(true);
      expect(handler.importNeedsPassword).toBe(false);
    });

    it('sets importNeedsPassword and does not open modal for encrypted archive', async () => {
      vi.mocked(commands.importProfile).mockResolvedValue(encryptedContents);
      await handler.init();
      await handler.handleChooseFile();
      expect(handler.importNeedsPassword).toBe(true);
      expect(handler.importModalOpen).toBe(false);
    });

    it('seeds strategy from provider defaultConflictStrategy', async () => {
      mockGetProviderById.mockReturnValue(makeProvider({ defaultConflictStrategy: 'replace' }));
      await handler.init();
      await handler.handleChooseFile();
      expect(handler.importCategories.get('snippets')?.strategy).toBe('replace');
    });
  });

  describe('handleImport()', () => {
    const provider = makeProvider();
    const archiveContents = {
      manifest_json: JSON.stringify({
        formatVersion: 1,
        appVersion: '0.1.0',
        exportedAt: 0,
        platform: '',
        hostname: '',
        encryptionScheme: null,
        encryptionSalt: null,
        hasSensitiveData: false,
        categories: [
          { id: 'snippets', displayName: 'Snippets', file: 'snippets.json', providerVersion: 1, itemCount: 3, syncTier: 'core', hasSensitiveFields: false },
          { id: 'settings', displayName: 'Settings', file: 'settings.json', providerVersion: 1, itemCount: 1, syncTier: 'core', hasSensitiveFields: false },
        ],
      }),
      category_files: {
        'snippets.json': JSON.stringify({ providerId: 'snippets', version: 1, exportedAt: 0, data: [] }),
        'settings.json': JSON.stringify({ providerId: 'settings', version: 1, exportedAt: 0, data: {} }),
      },
      asset_paths: [],
    };

    beforeEach(async () => {
      vi.mocked(commands.showOpenProfileDialog).mockResolvedValue('/path/backup.asyar');
      vi.mocked(commands.importProfile).mockResolvedValue(archiveContents);
      mockGetProviderById.mockReturnValue(provider);
      await handler.init();
      await handler.handleChooseFile();
    });

    it('calls applyImport for each enabled category and closes modal on success', async () => {
      await handler.handleImport();
      expect(provider.applyImport).toHaveBeenCalledTimes(2);
      expect(handler.importModalOpen).toBe(false);
      expect(handler.importStatus).toBe('success');
    });

    it('skips disabled categories', async () => {
      handler.importCategories.get('settings')!.enabled = false;
      await handler.handleImport();
      expect(provider.applyImport).toHaveBeenCalledTimes(1);
    });

    it('skips unregistered providers without throwing', async () => {
      mockGetProviderById.mockImplementation((id: string) =>
        id === 'snippets' ? provider : undefined,
      );
      await handler.handleImport();
      expect(provider.applyImport).toHaveBeenCalledTimes(1);
    });

    it('sets importStatus to error when applyImport throws', async () => {
      provider.applyImport.mockRejectedValue(new Error('store unavailable'));
      await handler.handleImport();
      expect(handler.importStatus).toBe('error');
      expect(handler.importMessage).toContain('store unavailable');
    });
  });

  describe('handleFileWithPassword()', () => {
    const archiveContents = {
      manifest_json: JSON.stringify({
        formatVersion: 1,
        appVersion: '0.1.0',
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
          itemCount: 3,
          syncTier: 'core',
          hasSensitiveFields: false,
        }],
      }),
      category_files: { 'snippets.json': JSON.stringify({ providerId: 'snippets', version: 1, exportedAt: 0, data: [] }) },
      asset_paths: [],
    };

    beforeEach(() => {
      vi.mocked(commands.importProfile).mockResolvedValue(archiveContents);
      mockGetProviderById.mockReturnValue(makeProvider());
      handler.importFile = '/path/backup.asyar';
      handler.importPassword = 'correct-password';
      handler.importNeedsPassword = true;
    });

    it('opens modal and clears importNeedsPassword on success', async () => {
      await handler.handleFileWithPassword();
      expect(commands.importProfile).toHaveBeenCalledWith('/path/backup.asyar', 'correct-password');
      expect(handler.importModalOpen).toBe(true);
      expect(handler.importNeedsPassword).toBe(false);
      expect(handler.importStatus).toBe('idle');
    });

    it('sets importStatus to error on wrong password', async () => {
      vi.mocked(commands.importProfile).mockRejectedValue(new Error('decryption failed'));
      await handler.handleFileWithPassword();
      expect(handler.importStatus).toBe('error');
      expect(handler.importMessage).toContain('decryption failed');
      expect(handler.importModalOpen).toBe(false);
    });
  });

  describe('closeImportModal()', () => {
    it('resets all import state', async () => {
      // Set up some state first
      handler.importModalOpen = true;
      handler.importFile = '/path/backup.asyar';
      handler.importStatus = 'success';
      handler.importMessage = 'Backup restored successfully.';
      handler.importNeedsPassword = true;
      handler.importPassword = 'secret';

      handler.closeImportModal();

      expect(handler.importModalOpen).toBe(false);
      expect(handler.importFile).toBe('');
      expect(handler.importStatus).toBe('idle');
      expect(handler.importMessage).toBe('');
      expect(handler.importNeedsPassword).toBe(false);
      expect(handler.importPassword).toBe('');
      expect(handler.importManifest).toBeNull();
      expect(handler.importCategories.size).toBe(0);
      expect(handler.importPreviewData.size).toBe(0);
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
