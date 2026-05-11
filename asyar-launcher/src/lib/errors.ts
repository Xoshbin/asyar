/**
 * Extract a human-readable message from any error shape we receive from
 * Tauri commands, agent loops, or fetch failures.
 *
 * Without this helper, callers would write `String(err)` which produces
 * the classic "[object Object]" for plain objects — the exact bug that
 * showed up in the run tracker when an MCP tool call failed with a Rust
 * `AppError` (which serializes to a Diagnostic-shaped object, not a JS
 * Error instance).
 *
 * Lookup order:
 *   1. nullish → "unknown error"
 *   2. string → as-is
 *   3. Error instance → `.message`
 *   4. Diagnostic-shaped object → `developerDetail`, then `message`, then `error`
 *   5. Last resort → JSON.stringify (still readable, never "[object Object]")
 */
export function extractErrorMessage(err: unknown): string {
  if (err == null) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.developerDetail === 'string' && obj.developerDetail.length > 0) {
      return obj.developerDetail;
    }
    if (typeof obj.message === 'string' && obj.message.length > 0) {
      return obj.message;
    }
    if (typeof obj.error === 'string' && obj.error.length > 0) {
      return obj.error;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return 'unserialisable error';
    }
  }
  return String(err);
}
