import { invoke } from '@tauri-apps/api/core';
import { settingsService } from '../settings/settingsService.svelte';

export interface FrontmostApplication {
  name: string;
  bundleId?: string;
  path?: string;
  windowTitle?: string;
}

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
}

export const applicationService = new ApplicationService();
