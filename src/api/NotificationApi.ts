import { notificationService } from "../services/NotificationService";
import type { NotificationActionType, NotificationChannel } from "../types";
import type { Options } from "@tauri-apps/plugin-notification";
import type { INotificationApi } from "./interfaces/INotificationApi";

/**
 * API for notification operations
 */
export class NotificationApi implements INotificationApi {
  /**
   * Check if notification permission is granted
   */
  async checkPermission(): Promise<boolean> {
    return await notificationService.checkPermission();
  }

  /**
   * Request notification permission from the user
   */
  async requestPermission(): Promise<boolean> {
    return await notificationService.requestPermission();
  }

  /**
   * Send a notification
   */
  async notify(options: Options): Promise<void> {
    await notificationService.notify(options);
  }

  /**
   * Register action types for notifications
   */
  async registerActionTypes(
    actionTypes: NotificationActionType[]
  ): Promise<void> {
    await notificationService.registerActionTypes(actionTypes);
  }
}
