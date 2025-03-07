import type {
  NotificationActionType,
  NotificationChannel,
} from "../../types/notification";

/**
 * Interface for Notification Service
 */
export interface INotificationService {
  checkPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  notify(options: NotificationOptions): Promise<void>;
  registerActionTypes(actionTypes: NotificationActionType[]): Promise<void>;
  listenForActions(callback: (notification: any) => void): Promise<void>;
  createChannel(channel: NotificationChannel): Promise<void>;
  getChannels(): Promise<any[]>;
  removeChannel(channelId: string): Promise<void>;
}
