import { invoke } from '@tauri-apps/api/core';

/**
 * Host-side thin wrapper over the Rust `system_events_*` Tauri commands.
 *
 * The ExtensionIpcRouter auto-injects the caller's `extensionId` (see
 * `INJECTS_EXTENSION_ID`) so each method takes the caller id as its first
 * arg. Privileged host-context calls pass `null`.
 */
export const systemEventsService = {
  async subscribe(
    extensionId: string | null,
    payload: { eventTypes: string[] },
  ): Promise<string> {
    return invoke<string>('system_events_subscribe', {
      extensionId,
      eventTypes: payload.eventTypes,
    });
  },

  async unsubscribe(
    extensionId: string | null,
    payload: { subscriptionId: string },
  ): Promise<void> {
    return invoke<void>('system_events_unsubscribe', {
      extensionId,
      subscriptionId: payload.subscriptionId,
    });
  },
};
