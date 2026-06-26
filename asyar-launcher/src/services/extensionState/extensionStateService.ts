import {
  stateGet,
  stateSet,
  stateSubscribe,
  stateUnsubscribe,
  stateRpcRequest,
  stateRpcAbort,
  stateRpcReply,
} from '../../lib/ipc/extensionLifecycleCommands';
import type { IpcDispatchOutcome } from '../../lib/ipc/iframeLifecycleCommands';
import { post } from '../extension/extensionDelivery';
import { logService } from '../log/logService';

/**
 * Host-side thin wrapper over the Rust `state_*` Tauri commands.
 *
 * The `ExtensionIpcRouter` auto-injects the caller's `extensionId` as the
 * first arg (see `INJECTS_EXTENSION_ID` — `'state'` is added alongside
 * `'storage'`/`'cache'`/etc.), so extensions never claim their own id. The
 * router also flattens the SDK proxy's payload object into positional args,
 * so the proxy sending `{ key }` lands here as `key: string`.
 */

/**
 * When Rust's worker-enqueue paths (`state_rpc_request`, `state_rpc_abort`)
 * return `ReadyDeliverNow`, the RPC envelope isn't in the worker mailbox —
 * it comes back inline so the frontend can post it straight into the
 * worker iframe. `NeedsMount` fires EVENT_MOUNT which the WorkerIframes
 * harness listens for; the drain happens on the ready-ack path. This
 * helper centralises both sides of that contract.
 */
function handleWorkerRpcOutcome(extensionId: string, outcome: IpcDispatchOutcome | null): void {
  if (outcome === null || outcome.kind !== 'readyDeliverNow') return;
  const iframe = document.querySelector(
    `iframe[data-extension-id="${extensionId}"][data-role="worker"]`,
  ) as HTMLIFrameElement | null;
  if (!iframe) {
    logService.warn(
      `[extensionStateService] ReadyDeliverNow for ${extensionId} but worker iframe DOM node is missing; ${outcome.messages.length} message(s) dropped`,
    );
    return;
  }
  for (const m of outcome.messages) post(iframe, m);
}

export const extensionStateService = {
  async get(extensionId: string, key: string): Promise<unknown> {
    return stateGet(extensionId, key);
  },

  async set(extensionId: string, key: string, value: unknown): Promise<void> {
    return stateSet(extensionId, key, value);
  },

  async subscribe(extensionId: string, key: string, role: 'worker' | 'view'): Promise<number | null> {
    return stateSubscribe(extensionId, key, role);
  },

  async unsubscribe(extensionId: string, subscriptionId: number): Promise<void> {
    // `subscriptionId` is the only arg Rust needs; extensionId is injected
    // by the router but Rust doesn't require it — pass it anyway so the
    // router's extensionId-first injection stays uniform with the other
    // state methods (matches the `storage`/`cache` convention even where
    // Rust would be fine with less).
    void extensionId;
    return stateUnsubscribe(subscriptionId);
  },

  async rpcRequest(
    extensionId: string,
    id: string,
    correlationId: string,
    payload: unknown,
  ): Promise<void> {
    const outcome = await stateRpcRequest(extensionId, id, correlationId, payload);
    handleWorkerRpcOutcome(extensionId, outcome);
  },

  async rpcAbort(extensionId: string, correlationId: string): Promise<void> {
    const outcome = await stateRpcAbort(extensionId, correlationId);
    handleWorkerRpcOutcome(extensionId, outcome);
  },

  async rpcReply(
    extensionId: string,
    correlationId: string,
    result?: unknown,
    error?: string,
  ): Promise<void> {
    return stateRpcReply(extensionId, correlationId, result, error);
  },
};
