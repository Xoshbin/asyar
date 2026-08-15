import { settingsService } from '../settings/settingsService.svelte';
import { feedbackService } from './feedbackService.svelte';
import { commandService } from '../extension/commandService.svelte';
import { logService } from '../log/logService';

export const FEEDBACK_NUDGE_DAYS = 3;

async function markSeen(): Promise<void> {
  await settingsService.updateSettings('feedback', { promptSeen: true });
}

/**
 * Checks whether to surface a one-time feedback prompt toast.
 * Shown after real usage (>= 3 days since first launch), never on first run.
 * Dismissible, non-blocking sticky toast.
 */
export async function checkAndNotifyFeedback(): Promise<void> {
  try {
    const feedbackSettings = settingsService.currentSettings.feedback;

    if (feedbackSettings?.promptSeen) {
      return;
    }

    const firstLaunchDate = feedbackSettings?.firstLaunchDate;
    if (!firstLaunchDate) {
      // First run / no record — record first launch timestamp silently so we don't nag immediately.
      await settingsService.updateSettings('feedback', {
        firstLaunchDate: new Date().toISOString(),
        promptSeen: false,
      });
      return;
    }

    const firstLaunchTime = new Date(firstLaunchDate).getTime();
    if (isNaN(firstLaunchTime)) {
      await settingsService.updateSettings('feedback', {
        firstLaunchDate: new Date().toISOString(),
        promptSeen: false,
      });
      return;
    }

    const daysElapsed = (Date.now() - firstLaunchTime) / (1000 * 60 * 60 * 24);
    if (daysElapsed < FEEDBACK_NUDGE_DAYS) {
      return;
    }

    await feedbackService.announceFromHost({
      id: 'feedback-nudge',
      title: "Got feedback? We're listening",
      message: 'Share an idea, praise, or report an issue',
      onClick: async () => {
        try {
          await commandService.executeCommand('cmd_feedback_send-feedback');
        } catch (e) {
          logService.warn(`Failed to open feedback command: ${e}`);
        }
        await markSeen();
      },
      onDismiss: async () => {
        await markSeen();
      },
    });
  } catch (e) {
    logService.warn(`Feedback nudge check failed: ${e}`);
  }
}
