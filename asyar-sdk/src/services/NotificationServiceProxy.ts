import type { INotificationService } from "./INotificationService";
import type { NotificationAction, NotificationOptions } from "../types/NotificationType";
import { BaseServiceProxy } from "./BaseServiceProxy";

export class NotificationServiceProxy extends BaseServiceProxy implements INotificationService {
  checkPermission(): Promise<boolean> {
    return this.broker.invoke<boolean>('notifications:checkPermission');
  }

  requestPermission(): Promise<boolean> {
    return this.broker.invoke<boolean>('notifications:requestPermission');
  }

  async send(options: NotificationOptions): Promise<string> {
    if (options.actions) {
      for (const a of options.actions) validateAction(a);
    }
    return this.broker.invoke<string>('notifications:send', { options });
  }

  dismiss(notificationId: string): Promise<void> {
    return this.broker.invoke<void>('notifications:dismiss', { notificationId });
  }
}

function validateAction(a: NotificationAction): void {
  if (!a.id) throw new Error(`NotificationAction requires a non-empty id`);
  if (!a.title) throw new Error(`NotificationAction "${a.id}" requires a non-empty title`);
  if (!a.commandId) {
    throw new Error(`NotificationAction "${a.id}" requires a non-empty commandId`);
  }
  if (a.args !== undefined) {
    try {
      JSON.stringify(a.args);
    } catch {
      throw new Error(
        `NotificationAction "${a.id}" args are not JSON-serialisable`,
      );
    }
  }
}
