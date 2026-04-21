import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
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

  describe('uninstallApplication', () => {
    it('invokes uninstall_application with the path and empty dataPaths by default', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await service.uninstallApplication('/Applications/Foo.app');

      expect(invoke).toHaveBeenCalledWith('uninstall_application', {
        path: '/Applications/Foo.app',
        dataPaths: [],
      });
    });

    it('forwards dataPaths when provided', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await service.uninstallApplication('/Applications/Foo.app', [
        '/Users/me/Library/Application Support/com.example.Foo',
        '/Users/me/Library/Preferences/com.example.Foo.plist',
      ]);

      expect(invoke).toHaveBeenCalledWith('uninstall_application', {
        path: '/Applications/Foo.app',
        dataPaths: [
          '/Users/me/Library/Application Support/com.example.Foo',
          '/Users/me/Library/Preferences/com.example.Foo.plist',
        ],
      });
    });

    it('propagates Rust errors to the caller', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        'Permission denied: cannot uninstall system-protected application',
      );

      await expect(
        service.uninstallApplication('/System/Applications/Calendar.app'),
      ).rejects.toMatch(/system-protected/);
    });
  });

  describe('scanUninstallTargets', () => {
    it('invokes scan_uninstall_targets with the path', async () => {
      const scan = {
        appPath: '/Applications/Foo.app',
        appSizeBytes: 1024,
        dataPaths: [
          {
            path: '/Users/me/Library/Application Support/com.example.Foo',
            sizeBytes: 500,
            category: 'Application data',
          },
        ],
        totalBytes: 1524,
      };
      vi.mocked(invoke).mockResolvedValueOnce(scan);

      const result = await service.scanUninstallTargets('/Applications/Foo.app');

      expect(invoke).toHaveBeenCalledWith('scan_uninstall_targets', {
        path: '/Applications/Foo.app',
      });
      expect(result).toEqual(scan);
    });

    it('propagates Rust errors (e.g. platform unsupported)', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        'Platform error: scan_uninstall_targets is only supported on macOS',
      );

      await expect(
        service.scanUninstallTargets('/Applications/Foo.app'),
      ).rejects.toMatch(/only supported on macOS/);
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
