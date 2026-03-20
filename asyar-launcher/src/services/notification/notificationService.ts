import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  registerActionTypes,
  onAction,
  createChannel,
  channels,
  removeChannel,
  type Options,
} from "@tauri-apps/plugin-notification";
import type {
  INotificationService,
  NotificationActionType,
  NotificationChannel,
} from "asyar-sdk";

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
    // Dev mode: use osascript via custom Rust command.
    // tauri-plugin-notification crashes in dev — it calls UNUserNotificationCenter
    // which requires a signed .app bundle, not available in `pnpm tauri dev`.
    if (import.meta.env.DEV) {
        await invoke('send_notification', {
            title: options.title ?? '',
            body:  options.body  ?? '',
        });
        return;
    }

    // Production: use the plugin with permission check (works in signed build)
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
