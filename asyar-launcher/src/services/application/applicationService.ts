import { invoke } from '@tauri-apps/api/core';
import { settingsService } from '../settings/settingsService.svelte';
import type { FrontmostApplication } from 'asyar-sdk';

/**
 * Host-side service that fulfils the query half of `ApplicationService`
 * (the `application:*` IPC namespace). It does NOT implement the SDK's
 * `IApplicationService` directly because the `on*` push subscriptions are
 * a client-side concern — those route through `appEventsService` on the
 * `appEvents:*` namespace, not through this service.
 */
export class ApplicationService {
  async getFrontmostApplication(): Promise<FrontmostApplication> {
    return await invoke<FrontmostApplication>('get_frontmost_application');
  }

  async syncApplicationIndex(extraPaths?: string[]): Promise<{ added: number; removed: number; total: number }> {
    const paths = extraPaths ?? settingsService.settings.search.additionalScanPaths ?? [];
    return await invoke('sync_application_index', { extraPaths: paths });
  }

  async listApplications(extraPaths?: string[]): Promise<any[]> {
    const paths = extraPaths ?? settingsService.settings.search.additionalScanPaths ?? [];
    return await invoke('list_applications', { extraPaths: paths });
  }

  async isRunning(
    extensionId: string | null,
    payload: { bundleId: string },
  ): Promise<boolean> {
    return await invoke<boolean>('app_is_running', {
      extensionId,
      bundleId: payload.bundleId,
    });
  }
}

export const applicationService = new ApplicationService();
