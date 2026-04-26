import * as commands from "../../lib/ipc/commands";
import { logService } from "../log/logService";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import type {
  NotificationAction,
  NotificationOptions,
} from "asyar-sdk/contracts";

/**
 * Host-side notification service. All real work happens in Rust —
 * this class is a thin call-site-friendly wrapper around the
 * `send_notification` / `dismiss_notification` Tauri commands.
 *
 * The `callerExtensionId` first argument is injected automatically by
 * `ExtensionIpcRouter` (via `INJECTS_EXTENSION_ID`); the host dispatch
 * shape therefore differs from the SDK's `INotificationService` (which
 * is what extensions see), so we don't declare `implements` here.
 */
export class NotificationService {
  async checkPermission(): Promise<boolean> {
    return await isPermissionGranted();
  }

  async requestPermission(): Promise<boolean> {
    const permission = await requestPermission();
    return permission === "granted";
  }

  async send(callerExtensionId: string, options: NotificationOptions): Promise<string> {
    const normalisedActions = options.actions?.map(normaliseAction);
    return commands.sendNotification({
      title: options.title,
      body: options.body,
      actions: normalisedActions,
      callerExtensionId,
    });
  }

  async dismiss(callerExtensionId: string, notificationId: string): Promise<void> {
    await commands.dismissNotification({ notificationId, callerExtensionId });
  }
}

export const notificationService = new NotificationService();

type WireAction = Omit<commands.NotificationActionInput, 'args'> & {
  args: Record<string, unknown> | null;
};

function normaliseAction(a: NotificationAction): WireAction {
  if (!a.id) {
    logService.warn(`[NotificationService] rejecting action with empty id`);
    throw new Error(`NotificationAction requires a non-empty id`);
  }
  if (!a.title) {
    throw new Error(`NotificationAction "${a.id}" requires a non-empty title`);
  }
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
  return {
    id: a.id,
    title: a.title,
    commandId: a.commandId,
    args: a.args ?? null,
  };
}
