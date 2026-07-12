/**
 * `null` means safe to remove silently; otherwise a human-readable warning
 * naming every consumer id (e.g. `mcp:<id>`, `ext:<id>`, `builtin:ext-builder`)
 * for `feedbackService.confirmAlert`'s message.
 */
export function describeRuntimeRemovalWarning(consumers: string[]): string | null {
  if (consumers.length === 0) return null;

  const list = consumers.join(', ');
  if (consumers.length === 1) {
    return `This runtime is still needed by 1 consumer (${list}). Remove it anyway?`;
  }
  return `This runtime is still needed by ${consumers.length} consumers (${list}). Remove it anyway?`;
}
