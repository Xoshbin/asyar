import { invoke } from '@tauri-apps/api/core';

/**
 * Host-side thin wrapper over the Rust `state_*` Tauri commands.
 *
 * The `ExtensionIpcRouter` auto-injects the caller's `extensionId` as the
 * first arg (see `INJECTS_EXTENSION_ID` — `'state'` is added alongside
 * `'storage'`/`'cache'`/etc.), so extensions never claim their own id. The
 * router also flattens the SDK proxy's payload object into positional args,
 * so the proxy sending `{ key }` lands here as `key: string`.
 */
export const extensionStateService = {
  async get(extensionId: string, key: string): Promise<unknown> {
    return invoke<unknown>('state_get', { extensionId, key });
  },

  async set(extensionId: string, key: string, value: unknown): Promise<void> {
    return invoke<void>('state_set', { extensionId, key, value });
  },

  async subscribe(extensionId: string, key: string, role: 'worker' | 'view'): Promise<number> {
    return invoke<number>('state_subscribe', { extensionId, key, role });
  },

  async unsubscribe(extensionId: string, subscriptionId: number): Promise<void> {
    // `subscriptionId` is the only arg Rust needs; extensionId is injected
    // by the router but Rust doesn't require it — pass it anyway so the
    // router's extensionId-first injection stays uniform with the other
    // state methods (matches the `storage`/`cache` convention even where
    // Rust would be fine with less).
    void extensionId;
    return invoke<void>('state_unsubscribe', { subscriptionId });
  },

  async rpcRequest(
    extensionId: string,
    id: string,
    correlationId: string,
    payload: unknown,
  ): Promise<void> {
    return invoke<void>('state_rpc_request', {
      extensionId,
      id,
      correlationId,
      payload,
    });
  },

  async rpcAbort(extensionId: string, correlationId: string): Promise<void> {
    return invoke<void>('state_rpc_abort', { extensionId, correlationId });
  },

  async rpcReply(
    extensionId: string,
    correlationId: string,
    result?: unknown,
    error?: string,
  ): Promise<void> {
    return invoke<void>('state_rpc_reply', {
      extensionId,
      correlationId,
      result: result ?? null,
      error: error ?? null,
    });
  },
};
