import * as commands from '../../lib/ipc/commands';
import { envService } from '../envService';
import { logService } from '../log/logService';
import { settingsService } from '../settings/settingsService.svelte';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AvailableUpdate, UpdateProgressStatus } from '../../types/ExtensionUpdate';

class ExtensionUpdateService {
  availableUpdates = $state<AvailableUpdate[]>([]);
  isChecking = $state(false);
  updatingExtensionIds = $state<Set<string>>(new Set());
  isUpdatingAll = $state(false);
  updateProgress = $state<UpdateProgressStatus | null>(null);
  lastCheckTime = $state<number | null>(null);

  updateCount = $derived(this.availableUpdates.length);
  hasUpdates = $derived(this.availableUpdates.length > 0);

  private unlistenTick: UnlistenFn | null = null;
  private unlistenProgress: UnlistenFn | null = null;
  private getActiveExtensionId: (() => string | null) | null = null;
  private reloadExtensions: (() => Promise<void>) | null = null;

  /**
   * Initialize the update service.
   * @param getActiveExtensionId - callback that returns the currently active extension ID (or null)
   * @param reloadExtensions - callback to hot-reload extensions after updates
   */
  async init(
    getActiveExtensionId: () => string | null,
    reloadExtensions: () => Promise<void>,
  ): Promise<void> {
    this.getActiveExtensionId = getActiveExtensionId;
    this.reloadExtensions = reloadExtensions;

    if (envService.isTauri) {
      this.unlistenProgress = await listen<UpdateProgressStatus>(
        'extension_update_progress',
        (event) => {
          this.updateProgress = event.payload;
        }
      );
      this.unlistenTick = await listen<void>('asyar:extension-update:tick', () => {
        this.checkAndAutoApply();
      });
    }
  }

  /**
   * Check for updates and auto-apply if the setting is enabled.
   * This is the main auto-update entry point — called on startup and periodically.
   */
  async checkAndAutoApply(): Promise<void> {
    const updates = await this.checkForUpdates();
    if (updates.length === 0) return;

    const autoUpdate = settingsService.currentSettings.extensions?.autoUpdate !== false;
    if (!autoUpdate) {
      logService.info(`Auto-update disabled. ${updates.length} update(s) available for manual install.`);
      return;
    }

    // Filter out the extension whose view is currently active to avoid mid-use disruption
    const activeExtId = this.getActiveExtensionId?.() ?? null;
    const safeUpdates = activeExtId
      ? updates.filter(u => u.extensionId !== activeExtId)
      : updates;

    if (safeUpdates.length === 0) {
      logService.info('Updates available but all are for the active extension — deferring.');
      return;
    }

    logService.info(`Auto-updating ${safeUpdates.length} extension(s) silently...`);

    try {
      const results = await commands.updateAllExtensions(safeUpdates);

      // Remove successful updates from the available list
      const failedIds = new Set(
        results.filter(([, r]) => r.Err).map(([id]) => id)
      );
      this.availableUpdates = this.availableUpdates.filter(
        u => failedIds.has(u.extensionId)
      );

      // Log results
      const successCount = results.filter(([, r]) => !r.Err).length;
      const failCount = results.filter(([, r]) => r.Err).length;
      if (successCount > 0) {
        logService.info(`Auto-updated ${successCount} extension(s) successfully.`);
      }
      if (failCount > 0) {
        logService.warn(`${failCount} extension(s) failed to auto-update.`);
        for (const [id, r] of results) {
          if (r.Err) logService.warn(`  - ${id}: ${r.Err}`);
        }
      }

      // Hot-reload if any succeeded
      if (successCount > 0 && this.reloadExtensions) {
        await this.reloadExtensions();
      }
    } catch (e: any) {
      logService.error(`Auto-update batch call failed: ${e}`);
    }
  }

  /**
   * Check the store API for available updates. Populates `availableUpdates`.
   */
  async checkForUpdates(): Promise<AvailableUpdate[]> {
    if (this.isChecking || !envService.isTauri) return this.availableUpdates;
    this.isChecking = true;
    try {
      const updates = await commands.checkExtensionUpdates(envService.storeApiBaseUrl);
      this.availableUpdates = updates;
      this.lastCheckTime = Date.now();
      if (updates.length > 0) {
        logService.info(`Update check complete: ${updates.length} update(s) available.`);
      }
      return updates;
    } catch (e: any) {
      logService.error(`Failed to check for extension updates: ${e}`);
      return [];
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Manually update a single extension (from UI).
   */
  async updateSingle(
    update: AvailableUpdate,
    reloadCallback: () => Promise<void>,
  ): Promise<boolean> {
    const newSet = new Set(this.updatingExtensionIds);
    newSet.add(update.extensionId);
    this.updatingExtensionIds = newSet;
    try {
      await commands.updateExtension(update);
      this.availableUpdates = this.availableUpdates.filter(
        u => u.extensionId !== update.extensionId
      );
      await reloadCallback();
      return true;
    } catch (e: any) {
      logService.error(`Failed to update ${update.extensionId}: ${e}`);
      return false;
    } finally {
      const cleaned = new Set(this.updatingExtensionIds);
      cleaned.delete(update.extensionId);
      this.updatingExtensionIds = cleaned;
    }
  }

  /**
   * Manually update all available extensions (from UI).
   */
  async updateAll(reloadCallback: () => Promise<void>): Promise<void> {
    this.isUpdatingAll = true;
    try {
      const results = await commands.updateAllExtensions([...this.availableUpdates]);
      const failedIds = new Set(
        results.filter(([, r]) => r.Err).map(([id]) => id)
      );
      this.availableUpdates = this.availableUpdates.filter(
        u => failedIds.has(u.extensionId)
      );
      await reloadCallback();
    } catch (e: any) {
      logService.error(`Failed to update all extensions: ${e}`);
    } finally {
      this.isUpdatingAll = false;
    }
  }

  /** Look up an available update for a specific extension. */
  getUpdateForExtension(extensionId: string): AvailableUpdate | undefined {
    return this.availableUpdates.find(u => u.extensionId === extensionId);
  }

  /** Check if a specific extension is currently being updated. */
  isExtensionUpdating(extensionId: string): boolean {
    return this.updatingExtensionIds.has(extensionId);
  }

  /** Clean up resources. */
  destroy(): void {
    this.unlistenTick?.();
    this.unlistenProgress?.();
  }
}

export const extensionUpdateService = new ExtensionUpdateService();
