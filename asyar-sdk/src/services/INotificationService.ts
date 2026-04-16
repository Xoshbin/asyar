import type {
  NotificationActionEvent,
  NotificationActionType,
  NotificationChannel,
  NotificationOptions,
} from "../types/NotificationType";

/**
 * Interface for Notification Service
 */
export interface INotificationService {
  checkPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  notify(options: NotificationOptions): Promise<void>;
  registerActionTypes(actionTypes: NotificationActionType[]): Promise<void>;
  listenForActions(callback: (event: NotificationActionEvent) => void): Promise<void>;
  createChannel(channel: NotificationChannel): Promise<void>;
  getChannels(): Promise<NotificationChannel[]>;
  removeChannel(channelId: string): Promise<void>;
}
