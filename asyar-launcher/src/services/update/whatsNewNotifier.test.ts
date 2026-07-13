import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BEFORE importing the module under test
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('../../lib/ipc/applicationCommands', () => ({
  appUpdaterShouldShowWhatsNew: vi.fn(),
}));
vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: { updates: { lastSeenVersion: undefined as string | undefined } },
    updateSettings: vi.fn(async () => true),
  },
}));
vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: { announceFromHost: vi.fn() },
}));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { checkAndNotifyWhatsNew } from './whatsNewNotifier';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { appUpdaterShouldShowWhatsNew } from '../../lib/ipc/applicationCommands';
import { settingsService } from '../settings/settingsService.svelte';
import { feedbackService } from '../feedback/feedbackService.svelte';

describe('checkAndNotifyWhatsNew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsService.currentSettings.updates!.lastSeenVersion = undefined;
    vi.mocked(getVersion).mockResolvedValue('0.1.1');
  });

  it('on a fresh install (no lastSeenVersion), silently records the current version and shows no notice', async () => {
    await checkAndNotifyWhatsNew();
    expect(settingsService.updateSettings).toHaveBeenCalledWith('updates', {
      lastSeenVersion: '0.1.1',
    });
    expect(feedbackService.announceFromHost).not.toHaveBeenCalled();
  });

  it('shows no notice when the version has not changed', async () => {
    settingsService.currentSettings.updates!.lastSeenVersion = '0.1.1';
    vi.mocked(appUpdaterShouldShowWhatsNew).mockResolvedValue(false);
    await checkAndNotifyWhatsNew();
    expect(feedbackService.announceFromHost).not.toHaveBeenCalled();
  });

  it('shows a sticky success notice when the version changed, without persisting yet', async () => {
    settingsService.currentSettings.updates!.lastSeenVersion = '0.1.0';
    vi.mocked(appUpdaterShouldShowWhatsNew).mockResolvedValue(true);
    await checkAndNotifyWhatsNew();

    expect(feedbackService.announceFromHost).toHaveBeenCalledOnce();
    const options = vi.mocked(feedbackService.announceFromHost).mock.calls[0][0];
    expect(options.id).toBe('whats-new-0.1.1');
    expect(options.title).toContain('0.1.1');
    expect(typeof options.onClick).toBe('function');
    expect(typeof options.onDismiss).toBe('function');
    // Only shown, not yet acknowledged — must not persist until the user acts.
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('clicking the notice opens the GitHub release page and persists lastSeenVersion', async () => {
    settingsService.currentSettings.updates!.lastSeenVersion = '0.1.0';
    vi.mocked(appUpdaterShouldShowWhatsNew).mockResolvedValue(true);
    await checkAndNotifyWhatsNew();

    const options = vi.mocked(feedbackService.announceFromHost).mock.calls[0][0];
    await options.onClick!();

    expect(openUrl).toHaveBeenCalledWith(
      'https://github.com/Xoshbin/asyar-launcher/releases/tag/v0.1.1',
    );
    expect(settingsService.updateSettings).toHaveBeenCalledWith('updates', {
      lastSeenVersion: '0.1.1',
    });
  });

  it('dismissing the notice (✕) persists lastSeenVersion without opening a URL', async () => {
    settingsService.currentSettings.updates!.lastSeenVersion = '0.1.0';
    vi.mocked(appUpdaterShouldShowWhatsNew).mockResolvedValue(true);
    await checkAndNotifyWhatsNew();

    const options = vi.mocked(feedbackService.announceFromHost).mock.calls[0][0];
    await options.onDismiss!();

    expect(openUrl).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).toHaveBeenCalledWith('updates', {
      lastSeenVersion: '0.1.1',
    });
  });
});
