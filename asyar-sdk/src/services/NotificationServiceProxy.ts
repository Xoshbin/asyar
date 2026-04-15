import type { INotificationService } from "./INotificationService";
import type { NotificationActionType, NotificationChannel, NotificationOptions } from "../types/NotificationType";
import { BaseServiceProxy } from "./BaseServiceProxy";

export class NotificationServiceProxy extends BaseServiceProxy implements INotificationService {
  checkPermission(): Promise<boolean> {
    return this.broker.invoke<boolean>('notifications:checkPermission');
  }

  requestPermission(): Promise<boolean> {
    return this.broker.invoke<boolean>('notifications:requestPermission');
  }

  notify(options: NotificationOptions): Promise<void> {
    return this.broker.invoke<void>('notifications:notify', { options });
  }

  registerActionTypes(actionTypes: NotificationActionType[]): Promise<void> {
    return this.broker.invoke<void>('notifications:registerActionTypes', { actionTypes });
  }

  listenForActions(callback: (notification: any) => void): Promise<void> {
    this.broker.on('asyar:event:notification:action', callback);
    return Promise.resolve();
  }

  createChannel(channel: NotificationChannel): Promise<void> {
    return this.broker.invoke<void>('notifications:createChannel', { channel });
  }

  getChannels(): Promise<any[]> {
    return this.broker.invoke<any[]>('notifications:getChannels');
  }

  removeChannel(channelId: string): Promise<void> {
    return this.broker.invoke<void>('notifications:removeChannel', { channelId });
  }
}

