/**
 * Dev-only diagnostic bridge. Emits `asyar:dev:rpc-log` and
 * `asyar:dev:ipc-log` postMessages to `window.parent` when the launcher
 * has set `window.__ASYAR_DEV_INSPECTOR_ACTIVE__ = true` on the iframe.
 *
 * Production launcher builds never set the flag, so every call here is a
 * single boolean guard then returns — no references held, no behaviour
 * change. Extensions that run outside an iframe (e.g. the CLI / tests)
 * are also silent: the `window`/`window.parent` guards bail.
 *
 * Fire-and-forget by design: postMessage errors are swallowed. The
 * inspector is an observational tool; it cannot be allowed to perturb the
 * SDK's actual RPC / IPC behaviour.
 */

export type RpcLogPhase = 'request' | 'resolved' | 'rejected' | 'timeout';
export type IpcLogPhase = 'invoke' | 'response';

export interface RpcLogPayload {
  phase: RpcLogPhase;
  id?: string;
  correlationId: string;
  payload?: unknown;
  result?: unknown;
  error?: string;
  timeoutMs?: number;
  elapsedMs?: number;
  timestamp: number;
  extensionId?: string;
}

export interface IpcLogPayload {
  phase: IpcLogPhase;
  command?: string;
  payload?: unknown;
  result?: unknown;
  error?: string;
  messageId: string;
  elapsedMs?: number;
  timestamp: number;
  extensionId?: string;
}

/**
 * Check whether the inspector is active. Exported so tests and callers
 * can short-circuit expensive payload serialisation before calling the
 * emitters. Never throws.
 */
export function isInspectorActive(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as unknown as { __ASYAR_DEV_INSPECTOR_ACTIVE__?: unknown })
    .__ASYAR_DEV_INSPECTOR_ACTIVE__ === true;
}

/**
 * Fire the RPC diagnostic observation. Returns immediately when the
 * inspector flag is absent — no allocation, no stringify, no postMessage.
 */
export function emitRpcLog(payload: RpcLogPayload): void {
  // Build-time dead-code gate: Vite replaces `import.meta.env.DEV` with a
  // literal at bundle time. In a production launcher build `!true` is
  // `false`, tree-shaking the rest of this function *and* the string
  // constants below. In npm consumers that don't define `import.meta.env`,
  // the optional chain evaluates to undefined → `!undefined` is `true` →
  // the emitter also bails.
  if (!((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)) return;
  if (!isInspectorActive()) return;
  postToParent('asyar:dev:rpc-log', payload);
}

/**
 * Fire the IPC diagnostic observation. See [`emitRpcLog`] for the
 * build-time dead-code gate and the runtime no-op guarantee when the flag
 * is absent.
 */
export function emitIpcLog(payload: IpcLogPayload): void {
  if (!((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)) return;
  if (!isInspectorActive()) return;
  postToParent('asyar:dev:ipc-log', payload);
}

function postToParent(type: string, payload: unknown): void {
  try {
    if (typeof window === 'undefined') return;
    const parent = window.parent;
    if (!parent || parent === window) return;
    parent.postMessage({ type, payload }, '*');
  } catch {
    // Fire-and-forget — swallow cross-origin or parent-access errors.
  }
}
