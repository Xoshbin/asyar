import { invoke } from '@tauri-apps/api/core';

/**
 * Host-side thin wrapper over the Rust `app_events_*` Tauri commands.
 *
 * The ExtensionIpcRouter auto-injects the caller's `extensionId` (see
 * `INJECTS_EXTENSION_ID`) so each method takes the caller id as its first
 * arg. Privileged host-context calls pass `null`.
 *
 * Same shape as `systemEventsService`; different wire target (`app_events_*`
 * vs `system_events_*` Tauri command names).
 */
export const appEventsService = {
  async subscribe(
    extensionId: string | null,
    payload: { eventTypes: string[] },
  ): Promise<string> {
    return invoke<string>('app_events_subscribe', {
      extensionId,
      eventTypes: payload.eventTypes,
    });
  },

  async unsubscribe(
    extensionId: string | null,
    payload: { subscriptionId: string },
  ): Promise<void> {
    return invoke<void>('app_events_unsubscribe', {
      extensionId,
      subscriptionId: payload.subscriptionId,
    });
  },
};
