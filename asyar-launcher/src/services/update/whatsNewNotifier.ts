import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { appUpdaterShouldShowWhatsNew } from '../../lib/ipc/applicationCommands';
import { settingsService } from '../settings/settingsService.svelte';
import { feedbackService } from '../feedback/feedbackService.svelte';
import { logService } from '../log/logService';

async function markSeen(version: string): Promise<void> {
  await settingsService.updateSettings('updates', { lastSeenVersion: version });
}

/**
 * Checks whether the app was just updated and, if so, surfaces a sticky
 * toast (non-blocking — the launcher stays fully usable). The toast is
 * only cleared by user action (open notes or dismiss), and either action
 * counts as "seen" so it never re-nags on the next launch.
 */
export async function checkAndNotifyWhatsNew(): Promise<void> {
  try {
    const currentVersion = await getVersion();
    const lastSeen = settingsService.currentSettings.updates?.lastSeenVersion;

    if (lastSeen == null) {
      // Fresh install — record silently so the next real update shows the notice.
      await markSeen(currentVersion);
      return;
    }

    const shouldShow = await appUpdaterShouldShowWhatsNew(lastSeen, currentVersion);
    if (!shouldShow) return;

    const releaseNotesUrl = `https://github.com/Xoshbin/asyar-launcher/releases/tag/v${currentVersion}`;
    await feedbackService.announceFromHost({
      id: `whats-new-${currentVersion}`,
      title: `Updated to v${currentVersion}`,
      message: 'Click to see what changed',
      onClick: async () => {
        await openUrl(releaseNotesUrl);
        await markSeen(currentVersion);
      },
      onDismiss: async () => {
        await markSeen(currentVersion);
      },
    });
  } catch (e) {
    logService.warn(`What's New check failed: ${e}`);
  }
}
