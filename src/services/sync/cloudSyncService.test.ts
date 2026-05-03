import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Declare mocks first
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../lib/ipc/commands', () => ({
  syncRun: vi.fn(),
  syncRestore: vi.fn(),
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

const okReport: commands.SyncRunReport = { uploaded: [], skipped: [], failed: [] };

describe('CloudSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      vi.mocked(commands.syncRun).mockResolvedValue(okReport);

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
      vi.mocked(commands.syncRun).mockResolvedValue(okReport);

      await cloudSyncService.upload();

      expect(profileService.collectExportData).toHaveBeenCalledWith({
        mode: 'sync',
        categoryIds: ['settings', 'aiConversations'],
      });
    });

    it('strips sensitiveFields from aiSettings data before handing it to syncRun', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);

      // sensitiveFields paths are relative to `data.data`, not the
      // outer SyncProviderData wrapper.
      const mockProviders = [
        { id: 'aiSettings', syncTier: 'core', sensitiveFields: ['apiKey'] },
      ];
      vi.mocked(profileService.getProviders).mockReturnValue(mockProviders as any);
      vi.mocked(profileService.getProviderById).mockImplementation(
        (id) => mockProviders.find((p) => p.id === id) as any,
      );

      const exportData = new Map([
        ['aiSettings', { data: { apiKey: 'secret-key', other: 'public' }, version: '1.0' }],
      ]);
      vi.mocked(profileService.collectExportData).mockResolvedValue(exportData as any);
      vi.mocked(commands.syncRun).mockResolvedValue(okReport);

      await cloudSyncService.upload();

      const inputs = vi.mocked(commands.syncRun).mock.calls[0][0];
      const aiTuple = inputs.find(([id]) => id === 'aiSettings')!;
      const handed = JSON.parse(aiTuple[1]);
      expect(handed.data.apiKey).toBeUndefined();
      expect(handed.data.other).toBe('public');
    });

    it('updates status and lastSyncedAt after a successful run', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(profileService.getProviders).mockReturnValue([]);
      vi.mocked(profileService.collectExportData).mockResolvedValue(new Map());
      vi.mocked(commands.syncRun).mockResolvedValue({
        uploaded: ['settings'],
        skipped: [],
        failed: [],
      });

      await cloudSyncService.upload();

      expect(cloudSyncService.status).toBe('idle');
      expect(cloudSyncService.lastSyncedAt).toBeInstanceOf(Date);
      expect(cloudSyncService.lastError).toBeNull();
    });

    it('sets status=error when collectExportData throws', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(profileService.getProviders).mockReturnValue([]);
      vi.mocked(profileService.collectExportData).mockRejectedValue(new Error('upload failed'));

      await cloudSyncService.upload();

      expect(cloudSyncService.status).toBe('error');
      expect(cloudSyncService.lastError).toBe('upload failed');
    });

    it('sets status=error when syncRun returns null (host failure)', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(profileService.getProviders).mockReturnValue([]);
      vi.mocked(profileService.collectExportData).mockResolvedValue(new Map());
      vi.mocked(commands.syncRun).mockResolvedValue(null);

      await cloudSyncService.upload();

      expect(cloudSyncService.status).toBe('error');
    });
  });

  describe('restore()', () => {
    it('returns idle without applying when server has nothing', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncRestore).mockResolvedValue([]);

      await cloudSyncService.restore();

      expect(cloudSyncService.status).toBe('idle');
      expect(cloudSyncService.lastError).toBeNull();
    });

    it('sets error if syncRestore returns null (host failure)', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncRestore).mockResolvedValue(null);

      await cloudSyncService.restore();

      expect(cloudSyncService.status).toBe('error');
      expect(cloudSyncService.lastError).toBe('Restore failed (host error)');
    });

    it('parses each restored category and applies imports', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);

      const restoredCategory = {
        categoryId: 'settings',
        plaintext: JSON.stringify({ data: { theme: 'dark' }, version: '1.0' }),
      };
      vi.mocked(commands.syncRestore).mockResolvedValue([restoredCategory]);

      const mockProvider = {
        applyImport: vi.fn(),
        defaultConflictStrategy: 'overwrite',
      };
      vi.mocked(profileService.getProviderById).mockReturnValue(mockProvider as any);

      await cloudSyncService.restore();

      expect(mockProvider.applyImport).toHaveBeenCalledWith(
        { data: { theme: 'dark' }, version: '1.0' },
        'overwrite',
      );
      expect(cloudSyncService.status).toBe('idle');
      expect(cloudSyncService.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('emits asyar:stores-restored after a non-empty restore', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncRestore).mockResolvedValue([
        { categoryId: 'clipboard', plaintext: JSON.stringify({ data: [], version: '1' }) },
      ]);
      vi.mocked(profileService.getProviderById).mockReturnValue({
        applyImport: vi.fn(),
        defaultConflictStrategy: 'merge',
      } as any);

      await cloudSyncService.restore();

      expect(emit).toHaveBeenCalledWith('asyar:stores-restored');
    });

    it('does not emit asyar:stores-restored when syncRestore throws', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncRestore).mockRejectedValue(new Error('network error'));

      await cloudSyncService.restore();

      expect(emit).not.toHaveBeenCalledWith('asyar:stores-restored');
      expect(cloudSyncService.status).toBe('error');
    });

    it('skips a category whose plaintext is malformed JSON without aborting', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);

      const goodProvider = { applyImport: vi.fn(), defaultConflictStrategy: 'merge' };
      vi.mocked(profileService.getProviderById).mockImplementation((id) => {
        if (id === 'good') return goodProvider as any;
        return undefined as any;
      });
      vi.mocked(commands.syncRestore).mockResolvedValue([
        { categoryId: 'broken', plaintext: 'not json {' },
        { categoryId: 'good', plaintext: JSON.stringify({ data: [], version: '1' }) },
      ]);

      await cloudSyncService.restore();

      expect(goodProvider.applyImport).toHaveBeenCalled();
      expect(cloudSyncService.status).toBe('idle');
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
      vi.mocked(commands.syncGetStatus).mockResolvedValue({
        lastSyncedAtIso: null,
        categoryCount: 0,
      });

      const uploadSpy = vi.spyOn(cloudSyncService, 'upload').mockResolvedValue();

      await cloudSyncService.init();

      expect(commands.syncGetStatus).toHaveBeenCalled();
      expect(uploadSpy).toHaveBeenCalled();
    });
  });

  describe('checkStatus()', () => {
    it('parses lastSyncedAtIso from response', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      const now = new Date().toISOString();
      vi.mocked(commands.syncGetStatus).mockResolvedValue({
        lastSyncedAtIso: now,
        categoryCount: 3,
      });

      await cloudSyncService.checkStatus();

      expect(cloudSyncService.lastSyncedAt).toEqual(new Date(now));
    });

    it('handles null lastSyncedAtIso', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncGetStatus).mockResolvedValue({
        lastSyncedAtIso: null,
        categoryCount: 0,
      });

      await cloudSyncService.checkStatus();

      expect(cloudSyncService.lastSyncedAt).toBeNull();
    });

    it('handles host failure (null response)', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncGetStatus).mockResolvedValue(null);

      await cloudSyncService.checkStatus();

      expect(cloudSyncService.lastSyncedAt).toBeNull();
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

    it('startPeriodicSync(): does not start if already running', () => {
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

      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('init() integration: calls startPeriodicSync after startup upload', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(true);
      vi.mocked(commands.syncGetStatus).mockResolvedValue({
        lastSyncedAtIso: null,
        categoryCount: 0,
      });
      const uploadSpy = vi.spyOn(cloudSyncService, 'upload').mockResolvedValue();
      const startSyncSpy = vi.spyOn(cloudSyncService, 'startPeriodicSync');

      await cloudSyncService.init();

      expect(startSyncSpy).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      expect(uploadSpy).toHaveBeenCalledTimes(2);
    });
  });
});
