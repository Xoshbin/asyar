import { profileService } from '../profile/profileService';
import { entitlementService } from '../auth/entitlementService.svelte';
import { logService } from '../log/logService';
import * as commands from '../../lib/ipc/commands';
import type { SyncProviderData } from '../profile/types';

const PERIODIC_SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface CloudSyncPayload {
  formatVersion: number;
  exportedAt: number;
  categories: Record<string, SyncProviderData>;
}

class CloudSyncService {
  status = $state<'idle' | 'uploading' | 'downloading' | 'error'>('idle');
  lastSyncedAt = $state<Date | null>(null);
  lastError = $state<string | null>(null);
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  async init(): Promise<void> {
    if (!entitlementService.check('sync:settings')) return;

    // Call checkStatus() — non-blocking
    await this.checkStatus().catch(err => {
      logService.warn(`Cloud sync checkStatus failed: ${err}`);
    });

    // Trigger upload() in background (do NOT await, catch errors silently)
    this.upload().catch(err => {
      logService.warn(`Cloud sync initial upload failed: ${err}`);
    });

    this.startPeriodicSync(); // keep syncing every 2 hours
  }

  startPeriodicSync(): void {
    if (this.syncTimer !== null) return; // already running
    this.syncTimer = setInterval(() => {
      this.upload().catch(err => {
        logService.warn(`Periodic cloud sync failed: ${err}`);
      });
    }, PERIODIC_SYNC_INTERVAL_MS);
  }

  stopPeriodicSync(): void {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async upload(): Promise<void> {
    if (!entitlementService.check('sync:settings')) {
      throw new Error('sync:settings entitlement required');
    }

    try {
      this.status = 'uploading';

      // Determine allowed provider IDs
      const allProviders = profileService.getProviders();
      const coreIds = allProviders.filter(p => p.syncTier === 'core').map(p => p.id);
      const extendedIds = entitlementService.check('sync:ai-conversations')
        ? allProviders.filter(p => p.syncTier === 'extended').map(p => p.id)
        : [];
      const allowedIds = [...coreIds, ...extendedIds];

      const exportData = await profileService.collectExportData({ mode: 'sync', categoryIds: allowedIds });

      // Strip sensitive fields from each category
      for (const [id, data] of exportData.entries()) {
        const provider = profileService.getProviderById(id);
        if (provider && provider.sensitiveFields.length > 0) {
          provider.sensitiveFields.forEach(path => stripField(data.data, path));
        }
      }

      const payload: CloudSyncPayload = {
        formatVersion: 1,
        exportedAt: Date.now(),
        categories: Object.fromEntries(exportData),
      };

      await commands.syncUpload(JSON.stringify(payload));

      this.status = 'idle';
      this.lastSyncedAt = new Date();
      this.lastError = null;
    } catch (err: any) {
      this.status = 'error';
      this.lastError = err.message;
      logService.error(`Cloud sync upload failed: ${err}`);
    }
  }

  async restore(): Promise<void> {
    if (!entitlementService.check('sync:settings')) {
      throw new Error('sync:settings entitlement required');
    }

    try {
      this.status = 'downloading';
      const raw = await commands.syncDownload();

      if (!raw) {
        this.status = 'error';
        this.lastError = 'No snapshot found in cloud';
        return;
      }

      const snapshot: CloudSyncPayload = JSON.parse(raw);

      for (const [id, data] of Object.entries(snapshot.categories)) {
        const provider = profileService.getProviderById(id);
        if (!provider) continue;
        await provider.applyImport(data, provider.defaultConflictStrategy);
      }

      this.status = 'idle';
      this.lastError = null;
      this.lastSyncedAt = new Date();
    } catch (err: any) {
      this.status = 'error';
      this.lastError = err.message;
      logService.error(`Cloud sync restore failed: ${err}`);
    }
  }

  async checkStatus(): Promise<void> {
    if (!entitlementService.check('sync:settings')) return;

    const statusResp = await commands.syncGetStatus();
    this.lastSyncedAt = statusResp.lastSyncedAt ? new Date(statusResp.lastSyncedAt) : null;
  }
}

function stripField(obj: unknown, dotPath: string): void {
  if (typeof obj !== 'object' || obj === null) return;
  const parts = dotPath.split('.');
  let current: Record<string, unknown> = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    current = current[parts[i]] as Record<string, unknown>;
    if (typeof current !== 'object' || current === null) return;
  }
  delete current[parts[parts.length - 1]];
}

export const cloudSyncService = new CloudSyncService();
