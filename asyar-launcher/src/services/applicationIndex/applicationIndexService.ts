import {
  applicationIndexSubscribe,
  applicationIndexUnsubscribe,
} from '../../lib/ipc/applicationCommands';

/**
 * Host-side thin wrapper over the Rust `application_index_*` Tauri
 * commands.
 *
 * Shape mirrors `appEventsService` / `systemEventsService`: the
 * ExtensionIpcRouter flattens the SDK proxy's payload via
 * `Object.values(payload)`, so `{ eventTypes: [...] }` from the SDK
 * arrives here as positional `eventTypes: string[]`. The router also
 * auto-injects the caller's `extensionId` as the first argument;
 * privileged host-context calls pass `null`.
 *
 * The Rust hub handles subscription bookkeeping and dispatch — this
 * service is pure IPC glue, no business logic.
 */
export const applicationIndexService = {
  async subscribe(
    extensionId: string | null,
    eventTypes: string[],
  ): Promise<string | null> {
    return applicationIndexSubscribe(extensionId, eventTypes);
  },

  async unsubscribe(
    extensionId: string | null,
    subscriptionId: string,
  ): Promise<void> {
    await applicationIndexUnsubscribe(extensionId, subscriptionId);
  },
};
