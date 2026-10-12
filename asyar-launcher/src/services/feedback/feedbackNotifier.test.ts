import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing module under test
vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      feedback: {
        promptSeen: false as boolean | undefined,
        firstLaunchDate: undefined as string | undefined,
      },
    },
    updateSettings: vi.fn(async () => true),
  },
}));
vi.mock('./feedbackService.svelte', () => ({
  feedbackService: { announceFromHost: vi.fn() },
}));
vi.mock('../extension/commandService.svelte', () => ({
  commandService: { executeCommand: vi.fn() },
}));
vi.mock('../opener/openerService', () => ({
  openerService: { open: vi.fn() },
}));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  checkAndNotifyFeedback,
  checkAndNotifySpread,
  SPREAD_NUDGE_DAYS,
} from './feedbackNotifier';
import { settingsService } from '../settings/settingsService.svelte';
import { feedbackService } from './feedbackService.svelte';
import { commandService } from '../extension/commandService.svelte';
import { openerService } from '../opener/openerService';

describe('checkAndNotifyFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsService.currentSettings.feedback = {
      promptSeen: false,
      firstLaunchDate: undefined,
    };
  });

  it('on a fresh install (no firstLaunchDate), silently records firstLaunchDate and shows no notice', async () => {
    await checkAndNotifyFeedback();
    expect(settingsService.updateSettings).toHaveBeenCalledWith(
      'feedback',
      expect.objectContaining({
        firstLaunchDate: expect.any(String),
        promptSeen: false,
      }),
    );
    expect(feedbackService.announceFromHost).not.toHaveBeenCalled();
  });

  it('shows no notice if promptSeen is already true', async () => {
    settingsService.currentSettings.feedback = {
      promptSeen: true,
      firstLaunchDate: '2026-01-01T00:00:00.000Z',
    };
    await checkAndNotifyFeedback();
    expect(feedbackService.announceFromHost).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('shows no notice if fewer than FEEDBACK_NUDGE_DAYS have passed since install', async () => {
    // 1 day ago
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    settingsService.currentSettings.feedback = {
      promptSeen: false,
      firstLaunchDate: oneDayAgo,
    };
    await checkAndNotifyFeedback();
    expect(feedbackService.announceFromHost).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('shows a sticky feedback toast when >= FEEDBACK_NUDGE_DAYS have passed', async () => {
    // 4 days ago
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    settingsService.currentSettings.feedback = {
      promptSeen: false,
      firstLaunchDate: fourDaysAgo,
    };

    await checkAndNotifyFeedback();

    expect(feedbackService.announceFromHost).toHaveBeenCalledOnce();
    const options = vi.mocked(feedbackService.announceFromHost).mock.calls[0][0];
    expect(options.id).toBe('feedback-nudge');
    expect(options.title.toLowerCase()).toContain('feedback');
    expect(typeof options.onClick).toBe('function');
    expect(typeof options.onDismiss).toBe('function');
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('clicking the notice executes the feedback command and marks promptSeen: true', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    settingsService.currentSettings.feedback = {
      promptSeen: false,
      firstLaunchDate: fourDaysAgo,
    };

    await checkAndNotifyFeedback();

    const options = vi.mocked(feedbackService.announceFromHost).mock.calls[0][0];
    await options.onClick!();

    expect(commandService.executeCommand).toHaveBeenCalledWith('cmd_feedback_send-feedback');
    expect(settingsService.updateSettings).toHaveBeenCalledWith('feedback', {
      promptSeen: true,
    });
  });

  it('dismissing the notice persists promptSeen: true without opening command', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    settingsService.currentSettings.feedback = {
      promptSeen: false,
      firstLaunchDate: fourDaysAgo,
    };

    await checkAndNotifyFeedback();

    const options = vi.mocked(feedbackService.announceFromHost).mock.calls[0][0];
    await options.onDismiss!();

    expect(commandService.executeCommand).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).toHaveBeenCalledWith('feedback', {
      promptSeen: true,
    });
  });
});

describe('checkAndNotifySpread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsService.currentSettings.feedback = {
      spreadPromptSeen: false,
      firstLaunchDate: undefined,
    };
  });

  it('shows no notice if there is no firstLaunchDate recorded yet', async () => {
    await checkAndNotifySpread();
    expect(feedbackService.announceFromHost).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('shows no notice if spreadPromptSeen is already true', async () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    settingsService.currentSettings.feedback = {
      spreadPromptSeen: true,
      firstLaunchDate: fifteenDaysAgo,
    };
    await checkAndNotifySpread();
    expect(feedbackService.announceFromHost).not.toHaveBeenCalled();
  });

  it(`shows no notice if fewer than ${SPREAD_NUDGE_DAYS} days have passed since install`, async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    settingsService.currentSettings.feedback = {
      spreadPromptSeen: false,
      firstLaunchDate: fiveDaysAgo,
    };
    await checkAndNotifySpread();
    expect(feedbackService.announceFromHost).not.toHaveBeenCalled();
  });

  it(`shows a sticky spread toast when >= ${SPREAD_NUDGE_DAYS} days have passed`, async () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    settingsService.currentSettings.feedback = {
      spreadPromptSeen: false,
      firstLaunchDate: fifteenDaysAgo,
    };

    await checkAndNotifySpread();

    expect(feedbackService.announceFromHost).toHaveBeenCalledOnce();
    const options = vi.mocked(feedbackService.announceFromHost).mock.calls[0][0];
    expect(options.id).toBe('spread-the-word');
    expect(typeof options.onClick).toBe('function');
    expect(typeof options.onDismiss).toBe('function');
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('clicking the notice opens the GitHub repo and marks spreadPromptSeen: true', async () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    settingsService.currentSettings.feedback = {
      spreadPromptSeen: false,
      firstLaunchDate: fifteenDaysAgo,
    };

    await checkAndNotifySpread();

    const options = vi.mocked(feedbackService.announceFromHost).mock.calls[0][0];
    await options.onClick!();

    expect(openerService.open).toHaveBeenCalledWith(
      null,
      'https://github.com/Xoshbin/asyar-launcher',
    );
    expect(settingsService.updateSettings).toHaveBeenCalledWith('feedback', {
      spreadPromptSeen: true,
    });
  });

  it('dismissing the notice marks spreadPromptSeen: true without opening the repo', async () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    settingsService.currentSettings.feedback = {
      spreadPromptSeen: false,
      firstLaunchDate: fifteenDaysAgo,
    };

    await checkAndNotifySpread();

    const options = vi.mocked(feedbackService.announceFromHost).mock.calls[0][0];
    await options.onDismiss!();

    expect(openerService.open).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).toHaveBeenCalledWith('feedback', {
      spreadPromptSeen: true,
    });
  });
});
