import type { NotificationOptions } from '../types/NotificationType';

export type FeedbackSeverity = 'info' | 'success' | 'warning' | 'error' | 'fatal';
export type FeedbackSource = 'rust' | 'frontend' | 'extension';

export interface FeedbackReport {
  kind: string;
  severity: FeedbackSeverity;
  retryable: boolean;
  context?: Record<string, string>;
  developerDetail?: string;
  retryActionId?: string;
  reportActionId?: string;
}

/** Host-stamped feedback shape used by Rust and launcher presenters. */
export interface Feedback extends FeedbackReport {
  source: FeedbackSource;
  extensionId?: string;
}

export interface FeedbackProgressOptions {
  title: string;
  completed?: number;
  total?: number;
}

export interface FeedbackProgressHandle {
  update(update: FeedbackProgressOptions): Promise<void>;
  succeed(title: string): Promise<void>;
  fail(title: string, developerDetail?: string): Promise<void>;
  dismiss(): Promise<void>;
}

/** Rare, host-controlled popup announcement. Not for operation feedback. */
export interface FeedbackAnnouncement {
  /** Stable identifier used to suppress repeats. */
  id: string;
  title: string;
  message?: string;
}

export interface ConfirmAlertOptions {
  /** Dialog heading. Required. */
  title: string;
  /** Body text. Required. */
  message: string;
  /** Confirm button label. Defaults to `"Confirm"`. */
  confirmText?: string;
  /** Cancel button label. Defaults to `"Cancel"`. */
  cancelText?: string;
  /**
   * Visual variant. `'danger'` shows ⚠️ + red confirm button.
   * Defaults to `'default'`.
   */
  variant?: 'default' | 'danger';
}

export type BackgroundFeedbackOptions = NotificationOptions;

/**
 * Unified feedback surface for built-ins and sandboxed extensions.
 */
export interface IFeedbackService {
  /** Show normal information, success, warning, or failure in the feedback bar. */
  report(feedback: FeedbackReport): Promise<void>;

  /** Show a host-managed progress item in the feedback bar. */
  showProgress(options: FeedbackProgressOptions): Promise<FeedbackProgressHandle>;

  /**
   * Request a rare popup announcement, such as What's New.
   * Requires `feedback:announce`; the host may suppress the request.
   */
  announce(announcement: FeedbackAnnouncement): Promise<void>;

  /** Deliver feedback for work that is not attached to a visible Asyar window. */
  sendBackground(options: BackgroundFeedbackOptions): Promise<string>;

  /** Dismiss background feedback that is no longer relevant. */
  dismissBackground(feedbackId: string): Promise<void>;

  /**
   * Show a HUD message at the bottom of the active screen AND close the
   * launcher window. Fire-and-forget. Auto-dismisses after ~1500ms.
   */
  showHUD(title: string): Promise<void>;

  /**
   * Show a blocking confirmation dialog. Resolves with `true` (confirmed)
   * or `false` (cancelled / Escape / backdrop click).
   *
   * Only one dialog can be open at a time. If a dialog is already open
   * when this is called, the new call resolves with `false` and the
   * existing dialog is left unchanged. Callers do NOT need to wrap this
   * in try/catch.
   */
  confirmAlert(options: ConfirmAlertOptions): Promise<boolean>;
}
