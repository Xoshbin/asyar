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
} from "@tauri-apps/plugin-notification";

export type NotificationOptions = {
  title: string;
  body: string;
  icon?: string;
  channelId?: string;
  attachments?: Array<{
    id: string;
    url: string; // Using asset:// or file:// protocol
  }>;
};

export type NotificationChannel = {
  id: string;
  name: string;
  description: string;
  importance?: Importance;
  visibility?: Visibility;
  lights?: boolean;
  lightColor?: string;
  vibration?: boolean;
  sound?: string;
};

export type NotificationActionType = {
  id: string;
  actions: Array<{
    id: string;
    title: string;
    requiresAuthentication?: boolean;
    foreground?: boolean;
    destructive?: boolean;
    input?: boolean;
    inputButtonTitle?: string;
    inputPlaceholder?: string;
  }>;
};

class NotificationService {
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
  async notify(options: NotificationOptions): Promise<void> {
    let permissionGranted = await this.checkPermission();

    if (!permissionGranted) {
      permissionGranted = await this.requestPermission();
      if (!permissionGranted) {
        console.warn("Notification permission not granted");
        return;
      }
    }

    await sendNotification(options);
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

export const notificationService = new NotificationService();
