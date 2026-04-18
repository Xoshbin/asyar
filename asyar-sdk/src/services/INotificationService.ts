import type { NotificationOptions } from "../types/NotificationType";

/**
 * Desktop notification service.
 *
 * Per-notification `actions` carry a `commandId`/`args` pair — when the
 * user clicks an action button the host dispatches the extension's
 * declared command directly, with no additional listener wiring needed
 * on the extension side.
 */
export interface INotificationService {
  checkPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  /**
   * Shows a desktop notification. Resolves with the notification id, which
   * callers can pass to `dismiss()` if the notification is no longer relevant.
   */
  send(options: NotificationOptions): Promise<string>;
  /** Dismiss a previously-shown notification and drop any pending actions. */
  dismiss(notificationId: string): Promise<void>;
}
