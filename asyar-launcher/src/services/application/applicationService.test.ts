import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    settings: {
      search: {
        additionalScanPaths: ['/custom/path'],
      },
    },
  },
}));

import { ApplicationService } from './applicationService';
import { invoke } from '@tauri-apps/api/core';

describe('ApplicationService', () => {
  let service: ApplicationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ApplicationService();
  });

  describe('getFrontmostApplication', () => {
    it('calls invoke with correct command', async () => {
      const mockApp = { name: 'Safari', bundleId: 'com.apple.Safari', windowTitle: 'Apple' };
      vi.mocked(invoke).mockResolvedValueOnce(mockApp);

      const result = await service.getFrontmostApplication();

      expect(invoke).toHaveBeenCalledWith('get_frontmost_application');
      expect(result).toEqual(mockApp);
    });
  });

  describe('syncApplicationIndex', () => {
    it('passes extraPaths when provided', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({ added: 1, removed: 0, total: 10 });

      await service.syncApplicationIndex(['/extra']);

      expect(invoke).toHaveBeenCalledWith('sync_application_index', { extraPaths: ['/extra'] });
    });

    it('falls back to settingsService paths when no extraPaths provided', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({ added: 0, removed: 0, total: 5 });

      await service.syncApplicationIndex();

      expect(invoke).toHaveBeenCalledWith('sync_application_index', { extraPaths: ['/custom/path'] });
    });
  });

  describe('listApplications', () => {
    it('passes extraPaths when provided', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]);

      await service.listApplications(['/extra']);

      expect(invoke).toHaveBeenCalledWith('list_applications', { extraPaths: ['/extra'] });
    });

    it('falls back to settingsService paths when no extraPaths provided', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]);

      await service.listApplications();

      expect(invoke).toHaveBeenCalledWith('list_applications', { extraPaths: ['/custom/path'] });
    });
  });
});
