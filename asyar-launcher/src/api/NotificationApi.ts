import {
  notificationService,
  type NotificationOptions,
  type NotificationChannel,
  type NotificationActionType,
} from "../services/notificationService";

/**
 * API wrapper for notification functionality
 */
export class NotificationApi {
  /**
   * Check if notification permission is granted
   */
  static async checkPermission(): Promise<boolean> {
    return await notificationService.checkPermission();
  }

  /**
   * Request notification permission from the user
   */
  static async requestPermission(): Promise<boolean> {
    return await notificationService.requestPermission();
  }

  /**
   * Send a notification to the user
   * @param options Notification configuration options
   */
  static async notify(options: NotificationOptions): Promise<void> {
    await notificationService.notify(options);
  }

  /**
   * Register action types for interactive notifications
   * @param actionTypes Array of action type configurations
   */
  static async registerActionTypes(
    actionTypes: NotificationActionType[]
  ): Promise<void> {
    await notificationService.registerActionTypes(actionTypes);
  }

  /**
   * Listen for actions performed on notifications
   * @param callback Function to execute when a notification action is triggered
   */
  static async listenForActions(
    callback: (notification: any) => void
  ): Promise<void> {
    await notificationService.listenForActions(callback);
  }

  /**
   * Create a notification channel (primarily for Android)
   * @param channel Channel configuration
   */
  static async createChannel(channel: NotificationChannel): Promise<void> {
    await notificationService.createChannel(channel);
  }

  /**
   * Get all notification channels
   */
  static async getChannels(): Promise<any[]> {
    return await notificationService.getChannels();
  }

  /**
   * Remove a notification channel
   * @param channelId ID of the channel to remove
   */
  static async removeChannel(channelId: string): Promise<void> {
    await notificationService.removeChannel(channelId);
  }
}
