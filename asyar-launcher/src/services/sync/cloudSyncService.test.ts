import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Declare mocks first
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../lib/ipc/commands', () => ({
  syncUpload: vi.fn(),
  syncDownload: vi.fn(),
  syncGetStatus: vi.fn(),
}));

vi.mock('../profile/profileService', () => ({
  profileService: {
    getProviders: vi.fn(),
    getProviderById: vi.fn(),
    collectExportData: vi.fn(),
  },
}));

vi.mock('../auth/entitlementService.svelte', () => ({
  entitlementService: {
    check: vi.fn(),
  },
}));

vi.mock('../log/logService', () => ({
  logService: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER mocks are declared
import { cloudSyncService } from './cloudSyncService.svelte';
import * as commands from '../../lib/ipc/commands';
import { profileService } from '../profile/profileService';
import { entitlementService } from '../auth/entitlementService.svelte';
import { emit } from '@tauri-apps/api/event';

describe('CloudSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset service state
    cloudSyncService.status = 'idle';
    cloudSyncService.lastSyncedAt = null;
    cloudSyncService.lastError = null;
    cloudSyncService.stopPeriodicSync();
  });

  describe('upload()', () => {
    it('throws if user lacks sync:settings entitlement', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(false);
      await expect(cloudSyncService.upload()).rejects.toThrow('sync:settings entitlement required');
    });

    it('collects only core providers when user lacks sync:ai-conversations', async () => {
      vi.mocked(entitlementService.check).mockImplementation((e) => e === 'sync:settings');
      
      const mockProviders = [
        { id: 'settings', syncTier: 'core', sensitiveFields: [] },
        { id: 'aiConversations', syncTier: 'extended', sensitiveFields: [] },
      ];
      vi.mocked(profileService.getProviders).mockReturnValue(mockProviders as any);
      vi.mocked(profileService.collectExportData).mockResolvedValue(new Map());

      await cloudSyncService.upload();

      expect(profileService.collectExportData).toHaveBeenCalledWith({
        mode: 'sync',
        categoryIds: ['settings'],
      });
    });

    it('collects all providers when user has both sync:settings and sync:ai-conversations', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      
      const mockProviders = [
        { id: 'settings', syncTier: 'core', sensitiveFields: [] },
        { id: 'aiConversations', syncTier: 'extended', sensitiveFields: [] },
      ];
      vi.mocked(profileService.getProviders).mockReturnValue(mockProviders as any);
      vi.mocked(profileService.collectExportData).mockResolvedValue(new Map());

      await cloudSyncService.upload();

      expect(profileService.collectExportData).toHaveBeenCalledWith({
        mode: 'sync',
        categoryIds: ['settings', 'aiConversations'],
      });
    });

    it('strips sensitiveFields from aiSettings data before calling syncUpload', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      
      const mockProviders = [
        { id: 'aiSettings', syncTier: 'core', sensitiveFields: ['apiKey'] },
      ];
      vi.mocked(profileService.getProviders).mockReturnValue(mockProviders as any);
      vi.mocked(profileService.getProviderById).mockImplementation((id) => mockProviders.find(p => p.id === id) as any);
      
      const exportData = new Map([
        ['aiSettings', { data: { apiKey: 'secret-key', other: 'public' }, version: '1.0' }]
      ]);
      vi.mocked(profileService.collectExportData).mockResolvedValue(exportData as any);

      await cloudSyncService.upload();

      const uploadCall = vi.mocked(commands.syncUpload).mock.calls[0][0];
      const payload = JSON.parse(uploadCall);
      expect(payload.categories.aiSettings.data.apiKey).toBeUndefined();
      expect(payload.categories.aiSettings.data.other).toBe('public');
    });

    it('updates status and lastSyncedAt after success', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(profileService.getProviders).mockReturnValue([]);
      vi.mocked(profileService.collectExportData).mockResolvedValue(new Map());
      
      await cloudSyncService.upload();

      expect(cloudSyncService.status).toBe('idle');
      expect(cloudSyncService.lastSyncedAt).toBeInstanceOf(Date);
      expect(cloudSyncService.lastError).toBeNull();
    });

    it('sets status to error on failure', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(profileService.getProviders).mockReturnValue([]);
      vi.mocked(profileService.collectExportData).mockRejectedValue(new Error('upload failed'));

      await cloudSyncService.upload();

      expect(cloudSyncService.status).toBe('error');
      expect(cloudSyncService.lastError).toBe('upload failed');
    });
  });

  describe('restore()', () => {
    it('sets lastError if no snapshot found', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncDownload).mockResolvedValue(null);

      await cloudSyncService.restore();

      expect(cloudSyncService.status).toBe('error');
      expect(cloudSyncService.lastError).toBe('No snapshot found in cloud');
    });

    it('parses snapshot and applies imports', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);

      const snapshot = {
        categories: {
          settings: { data: { theme: 'dark' }, version: '1.0' }
        }
      };
      vi.mocked(commands.syncDownload).mockResolvedValue(JSON.stringify(snapshot));

      const mockProvider = {
        applyImport: vi.fn(),
        defaultConflictStrategy: 'overwrite'
      };
      vi.mocked(profileService.getProviderById).mockReturnValue(mockProvider as any);

      await cloudSyncService.restore();

      expect(mockProvider.applyImport).toHaveBeenCalledWith(snapshot.categories.settings, 'overwrite');
      expect(cloudSyncService.status).toBe('idle');
      expect(cloudSyncService.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('emits asyar:stores-restored after successful restore', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      const snapshot = { categories: { clipboard: { data: [], version: '1' } } };
      vi.mocked(commands.syncDownload).mockResolvedValue(JSON.stringify(snapshot));
      vi.mocked(profileService.getProviderById).mockReturnValue({
        applyImport: vi.fn(),
        defaultConflictStrategy: 'merge',
      } as any);

      await cloudSyncService.restore();

      expect(emit).toHaveBeenCalledWith('asyar:stores-restored');
    });

    it('does not emit asyar:stores-restored when restore fails', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncDownload).mockRejectedValue(new Error('network error'));

      await cloudSyncService.restore();

      expect(emit).not.toHaveBeenCalledWith('asyar:stores-restored');
      expect(cloudSyncService.status).toBe('error');
    });
  });

  describe('init()', () => {
    it('does nothing if no sync:settings entitlement', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(false);
      
      await cloudSyncService.init();

      expect(commands.syncGetStatus).not.toHaveBeenCalled();
    });

    it('calls checkStatus and triggers upload if user has entitlement', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncGetStatus).mockResolvedValue({ lastSyncedAt: null, snapshotSize: 0 });
      
      const uploadSpy = vi.spyOn(cloudSyncService, 'upload').mockResolvedValue();

      await cloudSyncService.init();

      expect(commands.syncGetStatus).toHaveBeenCalled();
      expect(uploadSpy).toHaveBeenCalled();
    });
  });

  describe('checkStatus()', () => {
    it('updates lastSyncedAt from response', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      const now = new Date().toISOString();
      vi.mocked(commands.syncGetStatus).mockResolvedValue({ lastSyncedAt: now, snapshotSize: 100 });

      await cloudSyncService.checkStatus();

      expect(cloudSyncService.lastSyncedAt).toEqual(new Date(now));
    });
  });

  describe('periodic sync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      cloudSyncService.stopPeriodicSync();
      vi.useRealTimers();
    });

    it('startPeriodicSync(): does not start if already running', async () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      
      cloudSyncService.startPeriodicSync();
      cloudSyncService.startPeriodicSync();
      
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });

    it('stopPeriodicSync(): clears the timer', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const uploadSpy = vi.spyOn(cloudSyncService, 'upload').mockResolvedValue();
      
      cloudSyncService.startPeriodicSync();
      cloudSyncService.stopPeriodicSync();
      
      expect(clearIntervalSpy).toHaveBeenCalled();
      
      // Advance time to verify upload is not called
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('init() integration: calls startPeriodicSync after startup upload', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncGetStatus).mockResolvedValue({ lastSyncedAt: null, snapshotSize: 0 });
      const uploadSpy = vi.spyOn(cloudSyncService, 'upload').mockResolvedValue();
      const startSyncSpy = vi.spyOn(cloudSyncService, 'startPeriodicSync');

      await cloudSyncService.init();

      expect(startSyncSpy).toHaveBeenCalled();
      
      // Verify timer works (initial upload is called, then 2 hours later another)
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      expect(uploadSpy).toHaveBeenCalledTimes(2); // 1 initial + 1 periodic
    });
  });
});
