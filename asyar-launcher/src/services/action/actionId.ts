/**
 * Build the canonical `act_<extensionId>_<actionId>` id, idempotently: an
 * already-prefixed id is returned unchanged so a caller passing the full id
 * can't double-prefix it. Mirrors the SDK's builder in ExtensionBridge so the
 * host and the extension iframe always agree on the dispatch key.
 */
export function toFullActionId(extensionId: string, actionId: string): string {
  const prefix = `act_${extensionId}_`;
  return actionId.startsWith(prefix) ? actionId : `${prefix}${actionId}`;
}
