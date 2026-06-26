import { appEventsSubscribe, appEventsUnsubscribe } from '../../lib/ipc/systemCommands';

/**
 * Host-side thin wrapper over the Rust `app_events_*` Tauri commands.
 *
 * The ExtensionIpcRouter dispatches via `Object.values(payload)` — i.e. it
 * flattens the SDK proxy's payload object into POSITIONAL arguments (same
 * mechanism used by `systemEventsService`, `power`, etc.). So the SDK proxy
 * sending `{ eventTypes: [...] }` arrives here as `eventTypes: string[]`
 * positionally, and `{ subscriptionId: 'x' }` arrives as `subscriptionId:
 * string`. Mirroring that shape keeps the router and this service in sync.
 *
 * ExtensionIpcRouter also auto-injects the caller's `extensionId` as the
 * first arg (see `INJECTS_EXTENSION_ID`). Privileged host-context calls
 * pass `null`.
 */
export const appEventsService = {
  async subscribe(extensionId: string | null, eventTypes: string[]): Promise<string> {
    return (await appEventsSubscribe(extensionId, eventTypes)) ?? '';
  },

  async unsubscribe(extensionId: string | null, subscriptionId: string): Promise<void> {
    await appEventsUnsubscribe(extensionId, subscriptionId);
  },
};
