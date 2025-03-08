import type { NotificationChannel, NotificationActionType } from "../../types";
import type { Options } from "@tauri-apps/plugin-notification";

/**
 * Interface for Notification API
 */
export interface INotificationApi {
  /**
   * Check if notification permission is granted
   */
  checkPermission(): Promise<boolean>;

  /**
   * Request notification permission from the user
   */
  requestPermission(): Promise<boolean>;

  /**
   * Send a notification
   */
  notify(options: Options): Promise<void>;

  /**
   * Register action types for notifications
   */
  registerActionTypes(actionTypes: NotificationActionType[]): Promise<void>;
}
