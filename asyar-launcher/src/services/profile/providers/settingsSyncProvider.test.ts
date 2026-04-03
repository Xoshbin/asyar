import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsSyncProvider } from './settingsSyncProvider';
import type { SyncProviderData } from '../types';

const mockSettings = {
  general: { startAtLogin: false, showDockIcon: true },
  search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true, enableExtensionSearch: false },
  shortcut: { modifier: 'Alt', key: 'Space' },
  appearance: { theme: 'system', windowWidth: 800, windowHeight: 600 },
  extensions: { enabled: {} },
  calculator: { refreshInterval: 6 },
};

vi.mock('../../../services/settings/settingsService.svelte', () => {
  const settings = {
    general: { startAtLogin: false, showDockIcon: true },
    search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true, enableExtensionSearch: false },
    shortcut: { modifier: 'Alt', key: 'Space' },
    appearance: { theme: 'system', windowWidth: 800, windowHeight: 600 },
    extensions: { enabled: {} },
    calculator: { refreshInterval: 6 },
  };
  return {
    settingsService: {
      getSettings: vi.fn(() => ({ ...settings })),
      updateSettings: vi.fn().mockResolvedValue(true),
      currentSettings: settings,
    },
  };
});

describe('SettingsSyncProvider', () => {
  let provider: SettingsSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new SettingsSyncProvider();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('settings');
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('replace');
    expect(provider.sensitiveFields).toEqual([]);
  });

  describe('exportFull', () => {
    it('returns current settings', async () => {
      const result = await provider.exportFull();
      expect(result.providerId).toBe('settings');
      expect(result.version).toBe(1);
      expect(result.data).toEqual(mockSettings);
    });
  });

  describe('preview', () => {
    it('returns 1/1 for settings (always a single object)', async () => {
      const incoming: SyncProviderData = {
        providerId: 'settings',
        version: 1,
        exportedAt: Date.now(),
        data: mockSettings,
      };

      const preview = await provider.preview(incoming);
      expect(preview.localCount).toBe(1);
      expect(preview.incomingCount).toBe(1);
      expect(preview.conflicts).toBe(1);
      expect(preview.newItems).toBe(0);
      expect(preview.removedItems).toBe(0);
    });
  });

  describe('applyImport', () => {
    it('replace — calls updateSettings for each section', async () => {
      const { settingsService } = await import('../../../services/settings/settingsService.svelte');
      const incoming: SyncProviderData = {
        providerId: 'settings',
        version: 1,
        exportedAt: Date.now(),
        data: {
          general: { startAtLogin: true, showDockIcon: false },
          shortcut: { modifier: 'Cmd', key: 'Space' },
        },
      };

      const result = await provider.applyImport(incoming, 'replace');
      expect(settingsService.updateSettings).toHaveBeenCalledWith('general', { startAtLogin: true, showDockIcon: false });
      expect(settingsService.updateSettings).toHaveBeenCalledWith('shortcut', { modifier: 'Cmd', key: 'Space' });
      expect(settingsService.updateSettings).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.itemsUpdated).toBe(1);
    });

    it('merge — calls updateSettings for present sections', async () => {
      const { settingsService } = await import('../../../services/settings/settingsService.svelte');
      const incoming: SyncProviderData = {
        providerId: 'settings',
        version: 1,
        exportedAt: Date.now(),
        data: {
          appearance: { theme: 'dark', windowWidth: 1000, windowHeight: 700 },
        },
      };

      const result = await provider.applyImport(incoming, 'merge');
      expect(settingsService.updateSettings).toHaveBeenCalledWith('appearance', { theme: 'dark', windowWidth: 1000, windowHeight: 700 });
      expect(settingsService.updateSettings).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.itemsUpdated).toBe(1);
    });

    it('skip — does nothing', async () => {
      const { settingsService } = await import('../../../services/settings/settingsService.svelte');
      const incoming: SyncProviderData = {
        providerId: 'settings',
        version: 1,
        exportedAt: Date.now(),
        data: mockSettings,
      };

      const result = await provider.applyImport(incoming, 'skip');
      expect(settingsService.updateSettings).not.toHaveBeenCalled();
      expect(result.itemsAdded).toBe(0);
      expect(result.itemsUpdated).toBe(0);
    });
  });

  describe('getLocalSummary', () => {
    it('returns "Application settings"', async () => {
      const summary = await provider.getLocalSummary();
      expect(summary.itemCount).toBe(1);
      expect(summary.label).toBe('Application settings');
    });
  });
});
