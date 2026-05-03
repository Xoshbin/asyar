import { profileService } from '../profile/profileService';
import { entitlementService } from '../auth/entitlementService.svelte';
import { logService } from '../log/logService';
import * as commands from '../../lib/ipc/commands';
import { emit } from '@tauri-apps/api/event';

const PERIODIC_SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Per-category cloud sync (Layer 4a).
 *
 * Iterates registered `ISyncProvider`s, builds one (categoryId,
 * plaintext) tuple per provider, hands the array to Rust's `sync_run`
 * which hashes each, consults the local journal, and uploads only the
 * categories whose hash differs from the last upload. Skip-if-unchanged
 * keeps periodic syncs at near-zero bandwidth when nothing has changed.
 *
 * Restore is symmetric: ask the server for its category list, fetch
 * each whose hash differs from the journal, dispatch through the
 * matching provider's `applyImport()`.
 */
class CloudSyncService {
  status = $state<'idle' | 'uploading' | 'downloading' | 'error'>('idle');
  lastSyncedAt = $state<Date | null>(null);
  lastError = $state<string | null>(null);
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  async init(): Promise<void> {
    if (!entitlementService.check('sync:settings')) return;

    await this.checkStatus().catch((err) => {
      logService.warn(`Cloud sync checkStatus failed: ${err}`);
    });

    // Trigger upload() in background (do NOT await, catch errors silently)
    this.upload().catch((err) => {
      logService.warn(`Cloud sync initial upload failed: ${err}`);
    });

    this.startPeriodicSync();
  }

  startPeriodicSync(): void {
    if (this.syncTimer !== null) return;
    this.syncTimer = setInterval(() => {
      this.upload().catch((err) => {
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

  /**
   * Upload pass. Collects every entitlement-allowed provider's
   * `exportForSync()` output, strips declared `sensitiveFields`, and
   * hands the resulting `(category_id, plaintext)` tuples to Rust.
   * The Rust orchestrator decides per-category which to upload (via
   * SHA-256 hash + local journal lookup); the server-bound bytes are
   * `0` if no provider's data has changed since the last sync.
   */
  async upload(): Promise<void> {
    if (!entitlementService.check('sync:settings')) {
      throw new Error('sync:settings entitlement required');
    }

    try {
      this.status = 'uploading';

      const allProviders = profileService.getProviders();
      const coreIds = allProviders.filter((p) => p.syncTier === 'core').map((p) => p.id);
      const extendedIds = entitlementService.check('sync:ai-conversations')
        ? allProviders.filter((p) => p.syncTier === 'extended').map((p) => p.id)
        : [];
      const allowedIds = [...coreIds, ...extendedIds];

      const exportData = await profileService.collectExportData({
        mode: 'sync',
        categoryIds: allowedIds,
      });

      const inputs: Array<[string, string]> = [];
      for (const [id, data] of exportData.entries()) {
        const provider = profileService.getProviderById(id);
        if (provider && provider.sensitiveFields.length > 0) {
          provider.sensitiveFields.forEach((path) => stripField(data.data, path));
        }
        inputs.push([id, JSON.stringify(data)]);
      }

      const report = await commands.syncRun(inputs);
      if (!report) {
        // invokeSafe already surfaced a diagnostic; nothing more to do
        this.status = 'error';
        return;
      }

      if (report.failed.length > 0) {
        logService.warn(
          `Cloud sync upload had ${report.failed.length} failed categories: ${report.failed
            .map((f) => `${f.categoryId} (${f.reason})`)
            .join(', ')}`,
        );
      }

      this.status = 'idle';
      this.lastSyncedAt = new Date();
      this.lastError = null;
    } catch (err: any) {
      this.status = 'error';
      this.lastError = err.message;
      logService.error(`Cloud sync upload failed: ${err}`);
    }
  }

  /**
   * Restore pass. Asks Rust which server-side categories differ from
   * the local journal, gets back `(category_id, plaintext)` tuples,
   * dispatches each through the matching provider's `applyImport()`.
   * Emits `asyar:stores-restored` so the in-memory stores reload from
   * their newly-updated SQLite rows.
   */
  async restore(): Promise<void> {
    if (!entitlementService.check('sync:settings')) {
      throw new Error('sync:settings entitlement required');
    }

    try {
      this.status = 'downloading';
      const restored = await commands.syncRestore();

      if (!restored) {
        this.status = 'error';
        this.lastError = 'Restore failed (host error)';
        return;
      }

      if (restored.length === 0) {
        // Nothing on the server, or everything already in sync.
        this.status = 'idle';
        this.lastError = null;
        return;
      }

      for (const { categoryId, plaintext } of restored) {
        const provider = profileService.getProviderById(categoryId);
        if (!provider) continue;
        try {
          const data = JSON.parse(plaintext);
          await provider.applyImport(data, provider.defaultConflictStrategy);
        } catch (parseErr) {
          logService.warn(`Cloud sync restore parse failure for ${categoryId}: ${parseErr}`);
        }
      }

      await emit('asyar:stores-restored');

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
    if (statusResp?.lastSyncedAtIso) {
      this.lastSyncedAt = new Date(statusResp.lastSyncedAtIso);
    } else {
      this.lastSyncedAt = null;
    }
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
