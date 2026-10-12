import { t } from '../i18n';
import { settingsService } from '../settings/settingsService.svelte';
import { feedbackService } from './feedbackService.svelte';
import { commandService } from '../extension/commandService.svelte';
import { openerService } from '../opener/openerService';
import { logService } from '../log/logService';

export const FEEDBACK_NUDGE_DAYS = 3;
export const SPREAD_NUDGE_DAYS = 0; // TEMP: smoke test — revert to 14

const ASYAR_REPO_URL = 'https://github.com/Xoshbin/asyar-launcher';

async function markSeen(): Promise<void> {
  await settingsService.updateSettings('feedback', { promptSeen: true });
}

async function markSpreadSeen(): Promise<void> {
  await settingsService.updateSettings('feedback', { spreadPromptSeen: true });
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
      title: t('feedback_nudge.title'),
      message: t('feedback_nudge.message'),
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

/**
 * Checks whether to surface a one-time "spread the word" toast.
 * Shown after real usage (>= 14 days since first launch), never on first run.
 * Clicking opens the GitHub repo. Dismissible, non-blocking sticky toast.
 */
export async function checkAndNotifySpread(): Promise<void> {
  try {
    const feedbackSettings = settingsService.currentSettings.feedback;

    if (feedbackSettings?.spreadPromptSeen) {
      return;
    }

    const firstLaunchDate = feedbackSettings?.firstLaunchDate;
    if (!firstLaunchDate) {
      return;
    }

    const firstLaunchTime = new Date(firstLaunchDate).getTime();
    if (isNaN(firstLaunchTime)) {
      return;
    }

    const daysElapsed = (Date.now() - firstLaunchTime) / (1000 * 60 * 60 * 24);
    if (daysElapsed < SPREAD_NUDGE_DAYS) {
      return;
    }

    await feedbackService.announceFromHost({
      id: 'spread-the-word',
      title: t('spread_nudge.title'),
      message: t('spread_nudge.message'),
      onClick: async () => {
        try {
          await openerService.open(null, ASYAR_REPO_URL);
        } catch (e) {
          logService.warn(`Failed to open Asyar repo: ${e}`);
        }
        await markSpreadSeen();
      },
      onDismiss: async () => {
        await markSpreadSeen();
      },
    });
  } catch (e) {
    logService.warn(`Spread nudge check failed: ${e}`);
  }
}
