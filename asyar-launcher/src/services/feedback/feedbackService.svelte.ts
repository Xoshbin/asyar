import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ConfirmAlertOptions,
  FeedbackAnnouncement,
  FeedbackProgressHandle,
  FeedbackProgressOptions,
  FeedbackReport,
  IFeedbackService,
} from 'asyar-sdk/contracts';
import * as commands from '../../lib/ipc/commands';
import * as feedbackCommands from './internal/feedbackCommands';
import type { NotificationOptions } from 'asyar-sdk/contracts';
import { notificationService } from '../notification/notificationService';

interface ActiveAnnouncement {
  id: string;
  title: string;
  message?: string;
  extensionId: string;
  onClick?: () => void;
  onDismiss?: () => void;
}

export interface HostAnnouncementOptions extends FeedbackAnnouncement {
  title: string;
  message?: string;
  onClick?: () => void;
  onDismiss?: () => void;
}

export type HostFeedbackReport = FeedbackReport & {
  source?: 'rust' | 'frontend' | 'extension';
  extensionId?: string;
};

interface ActiveDialog {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
}

/** Default HUD visibility duration. */
const DEFAULT_HUD_DURATION_MS = 1500;

/**
 * Live handle on a spinning HUD. Returned by `showHUDSpinning`. The HUD stays
 * visible until you call `.dismiss()` or `.replace(...)`. `.replace(title)`
 * by default flips the HUD to a non-spinning state and schedules auto-hide,
 * which is the usual transition on success ("Done") or failure ("Error: …").
 */
export interface HudSpinnerHandle {
  /**
   * Replace the displayed title. By default the spinner stops and the HUD
   * is auto-hidden after `durationMs` (default 1500ms). Pass `spinning: true`
   * to keep the spinner visible (e.g. progress phases like "Reading…" →
   * "Thinking…").
   */
  replace(title: string, options?: { spinning?: boolean; durationMs?: number }): Promise<void>;
  /** Hide the HUD now. */
  dismiss(): Promise<void>;
}

class FeedbackService implements IFeedbackService {
  current = $state<feedbackCommands.FeedbackItem | null>(null);
  activeAnnouncement = $state<ActiveAnnouncement | null>(null);
  activeDialog = $state<ActiveDialog | null>(null);

  private dialogResolver: ((result: boolean) => void) | null = null;
  private retryRegistry = new Map<string, () => Promise<void>>();
  private reportRegistry = new Map<string, () => Promise<void>>();
  private actionSequence = 0;
  private unlisten: UnlistenFn | null = null;

  async initialize(): Promise<void> {
    if (this.unlisten) return;
    try {
      this.current = await feedbackCommands.getCurrent();
      this.unlisten = await listen<feedbackCommands.FeedbackItem | null>(
        'feedback:changed',
        ({ payload }) => {
          this.current = payload;
        },
      );
    } catch {
      // Feedback must never break the operation it describes.
    }
  }

  reset(): void {
    this.current = null;
    this.activeAnnouncement = null;
    this.activeDialog = null;
    this.dialogResolver = null;
    this.retryRegistry.clear();
    this.reportRegistry.clear();
    this.actionSequence = 0;
  }

  async report(feedback: HostFeedbackReport): Promise<void> {
    try {
      await feedbackCommands.publish({
        source: feedback.source ?? 'frontend',
        kind: feedback.kind,
        severity: feedback.severity,
        retryable: feedback.retryable,
        context: feedback.context ?? {},
        developerDetail: feedback.developerDetail,
        extensionId: feedback.extensionId,
        retryActionId: feedback.retryActionId,
        reportActionId: feedback.reportActionId,
      });
    } catch {
      // Feedback must never break the operation it describes.
    }
  }

  async showProgress(options: FeedbackProgressOptions): Promise<FeedbackProgressHandle> {
    const feedbackId = await this.startProgressForSource('frontend', undefined, options);
    return this.createProgressHandle(feedbackId);
  }

  startProgressForExtension(
    extensionId: string,
    options: FeedbackProgressOptions,
  ): Promise<string> {
    return this.startProgressForSource('extension', extensionId, options);
  }

  private startProgressForSource(
    source: 'frontend' | 'extension',
    extensionId: string | undefined,
    options: FeedbackProgressOptions,
  ): Promise<string> {
    return feedbackCommands.publish({
      source,
      kind: 'progress',
      severity: 'progress',
      retryable: false,
      context: {},
      extensionId,
      progress: options,
    });
  }

  private createProgressHandle(feedbackId: string): FeedbackProgressHandle {
    return {
      update: (update) => feedbackCommands.updateProgress(feedbackId, update),
      succeed: (title) => feedbackCommands.finishProgress(feedbackId, 'success', title),
      fail: (title, developerDetail) =>
        feedbackCommands.finishProgress(feedbackId, 'error', title, developerDetail),
      dismiss: () => this.dismissOwned(feedbackId),
    };
  }

  async announceForExtension(
    extensionId: string,
    announcement: FeedbackAnnouncement,
  ): Promise<void> {
    if (this.activeAnnouncement) return;
    if (!(await feedbackCommands.acceptAnnouncement(extensionId, announcement.id))) return;
    this.activeAnnouncement = { ...announcement, extensionId };
  }

  announce(announcement: FeedbackAnnouncement): Promise<void> {
    return this.announceForExtension('asyar', announcement);
  }

  async announceFromHost(options: HostAnnouncementOptions): Promise<void> {
    if (this.activeAnnouncement) return;
    if (!(await feedbackCommands.acceptAnnouncement('asyar', options.id))) return;
    this.activeAnnouncement = { ...options, extensionId: 'asyar' };
  }

  sendBackground(options: NotificationOptions): Promise<string> {
    return this.sendBackgroundForSource('asyar', options);
  }

  sendBackgroundForSource(sourceId: string, options: NotificationOptions): Promise<string> {
    return notificationService.send(sourceId, options);
  }

  dismissBackground(feedbackId: string): Promise<void> {
    return this.dismissBackgroundForSource('asyar', feedbackId);
  }

  dismissBackgroundForSource(sourceId: string, feedbackId: string): Promise<void> {
    return notificationService.dismiss(sourceId, feedbackId);
  }

  checkBackgroundPermission(): Promise<boolean> {
    return notificationService.checkPermission();
  }

  requestBackgroundPermission(): Promise<boolean> {
    return notificationService.requestPermission();
  }

  updateProgressForExtension(
    extensionId: string,
    feedbackId: string,
    update: FeedbackProgressOptions,
  ): Promise<void> {
    return feedbackCommands.updateProgress(feedbackId, update, extensionId);
  }

  finishProgressForExtension(
    extensionId: string,
    feedbackId: string,
    outcome: { severity: 'success' | 'error'; title: string; developerDetail?: string },
  ): Promise<void> {
    return feedbackCommands.finishProgress(
      feedbackId,
      outcome.severity,
      outcome.title,
      outcome.developerDetail,
      extensionId,
    );
  }

  dismissForExtension(extensionId: string, feedbackId: string): Promise<void> {
    return this.dismissOwned(feedbackId, extensionId);
  }

  onAnnouncementClicked(): void {
    const announcement = this.activeAnnouncement;
    if (!announcement?.onClick) return;
    this.activeAnnouncement = null;
    announcement.onClick();
  }

  onAnnouncementDismissed(): void {
    const announcement = this.activeAnnouncement;
    this.activeAnnouncement = null;
    announcement?.onDismiss?.();
  }

  dismiss(feedbackId = this.current?.id): Promise<void> {
    return feedbackId ? this.dismissOwned(feedbackId) : Promise.resolve();
  }

  private async dismissOwned(feedbackId: string, expectedExtensionId?: string): Promise<void> {
    const next = expectedExtensionId
      ? await feedbackCommands.dismiss(feedbackId, expectedExtensionId)
      : await feedbackCommands.dismiss(feedbackId);
    if (this.current?.id === feedbackId) {
      this.current = next;
    }
  }

  registerRetry(fn: () => Promise<void>): string {
    const id = `retry-${++this.actionSequence}`;
    this.retryRegistry.set(id, fn);
    return id;
  }

  async triggerRetry(id: string): Promise<void> {
    const retry = this.retryRegistry.get(id);
    if (!retry) return;
    this.retryRegistry.delete(id);
    await retry();
  }

  registerReport(fn: () => Promise<void>): string {
    const id = `report-${++this.actionSequence}`;
    this.reportRegistry.set(id, fn);
    return id;
  }

  async triggerReport(id: string): Promise<void> {
    await this.reportRegistry.get(id)?.();
  }

  async showHUD(title: string): Promise<void> {
    // Show the HUD window first (Rust positions it, displays the title, schedules
    // auto-hide), then hide the main launcher window. The HUD lives in its own
    // Tauri window, so it survives the main launcher hide.
    await commands.showHud({ title, durationMs: DEFAULT_HUD_DURATION_MS, spinning: false });
    try {
      await commands.hideWindow();
    } catch {
      // hideWindow can fail if called from a context where the main window is
      // already hidden (e.g. settings window). The HUD still shows correctly.
    }
  }

  /**
   * Show a HUD with a spinner that stays visible until dismissed or replaced.
   * Use for headless operations whose duration the user can't see — silent AI
   * commands, long-running shell-script triggers, anything where the launcher
   * window is hidden and the user needs a "this is running" signal.
   *
   * Returns a handle so the caller can drive lifecycle transitions:
   *   - `handle.replace('Done')` flips to a non-spinning HUD that auto-hides.
   *   - `handle.replace('Working...', { spinning: true })` updates the
   *     title without stopping the spinner (e.g. multi-phase progress).
   *   - `handle.dismiss()` hides the HUD immediately (useful when the
   *     visible result is the feedback — e.g. text replaced in place).
   */
  showHUDSpinning(title: string): HudSpinnerHandle {
    void commands.showHud({ title, durationMs: 0, spinning: true });
    return {
      replace: async (newTitle, options) => {
        const spinning = options?.spinning ?? false;
        const durationMs = options?.durationMs ?? DEFAULT_HUD_DURATION_MS;
        await commands.showHud({ title: newTitle, durationMs, spinning });
      },
      dismiss: async () => {
        await commands.hideHud();
      },
    };
  }

  async confirmAlert(options: ConfirmAlertOptions): Promise<boolean> {
    // If a dialog is already open, treat the second call as cancelled.
    // This matches Raycast's behavior and avoids forcing every caller to
    // wrap confirmAlert in try/catch just to handle a race condition.
    // The first dialog continues unaffected.
    if (this.activeDialog !== null) {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      this.dialogResolver = resolve;
      this.activeDialog = {
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        variant: options.variant,
      };
    });
  }

  /** Called by `<DialogHost />` when the user clicks Confirm. */
  onDialogConfirmed(): void {
    const resolver = this.dialogResolver;
    this.dialogResolver = null;
    this.activeDialog = null;
    resolver?.(true);
  }

  /** Called by `<DialogHost />` when the user clicks Cancel, presses Escape, or clicks the backdrop. */
  onDialogCancelled(): void {
    const resolver = this.dialogResolver;
    this.dialogResolver = null;
    this.activeDialog = null;
    resolver?.(false);
  }
}

export const feedbackService = new FeedbackService();
