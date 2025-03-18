import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  registerActionTypes,
  onAction,
  createChannel,
  Importance,
  Visibility,
  channels,
  removeChannel,
  type Options,
} from "@tauri-apps/plugin-notification";
import type { NotificationActionType, NotificationChannel } from "../types";
import type { INotificationService } from "asyar-api";

export class NotificationService implements INotificationService {
  /**
   * Check if notification permission is granted
   */
  async checkPermission(): Promise<boolean> {
    return await isPermissionGranted();
  }

  /**
   * Request notification permission
   */
  async requestPermission(): Promise<boolean> {
    const permission = await requestPermission();
    return permission === "granted";
  }

  /**
   * Send a notification
   */
  async notify(options: Options): Promise<void> {
    let permissionGranted = await this.checkPermission();

    if (!permissionGranted) {
      permissionGranted = await this.requestPermission();
      if (!permissionGranted) {
        console.warn("Notification permission not granted");
        return;
      }
    }

    sendNotification(options);
  }

  /**
   * Register action types for interactive notifications
   * (primarily for mobile platforms)
   */
  async registerActionTypes(
    actionTypes: NotificationActionType[]
  ): Promise<void> {
    await registerActionTypes(actionTypes);
  }

  /**
   * Listen for actions performed on notifications
   */
  async listenForActions(callback: (notification: any) => void): Promise<void> {
    await onAction(callback);
  }

  /**
   * Create a notification channel
   * (primarily for Android, but provides consistent API across platforms)
   */
  async createChannel(channel: NotificationChannel): Promise<void> {
    await createChannel(channel);
  }

  /**
   * Get all notification channels
   */
  async getChannels(): Promise<any[]> {
    return await channels();
  }

  /**
   * Remove a notification channel
   */
  async removeChannel(channelId: string): Promise<void> {
    await removeChannel(channelId);
  }
}
