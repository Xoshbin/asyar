import { isFeedbackShape } from '../../../lib/ipc/invokeSafe';

/**
 * Every EXTENSION_INVOKE_DISPATCH handler delegates to an invokeSafe-backed
 * commands.ts wrapper, which returns null on failure instead of throwing —
 * and has already reported a diagnostic for that failure itself. Thrown to
 * signal "build the asyar:response error envelope" without making the
 * replyEnvelope stage report a second, redundant diagnostic.
 */
export class HandledDispatchError extends Error {}

/**
 * Rust commands that reject via raw `invoke()` (files:read/glob/thumbnail,
 * invokeRaw callers) surface a serialized `AppError` — a plain object shaped
 * like `Feedback`, not an `Error` instance. `String()` on that object yields
 * the useless "[object Object]"; `developerDetail` carries the real message.
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isFeedbackShape(error)) return error.developerDetail ?? String(error);
  return String(error);
}

export function classifyProxyError(
  _method: string,
  msg: string | undefined,
): 'permission_denied' | 'rpc_timeout' | 'extension_proxy_error' {
  const m = (msg ?? '').toLowerCase();
  if (m.includes('permission')) return 'permission_denied';
  if (m.includes('timeout')) return 'rpc_timeout';
  return 'extension_proxy_error';
}
