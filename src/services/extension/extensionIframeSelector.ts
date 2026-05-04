/**
 * Prefer the given role's iframe, fall back to the other role, then to an
 * unscoped selector. Without this, an unfiltered `iframe[data-extension-id]`
 * selector hits whichever iframe comes first in DOM order (typically the
 * view) and a message meant for a worker-only handler vanishes silently.
 *
 * Canonical Tier 2 role-aware selector: every host-to-iframe push that
 * targets a specific role must go through this helper rather than building
 * its own `iframe[data-extension-id]` query inline. See the `review-ipc`
 * skill, section 4.
 */
export function pickExtensionIframe(
  extensionId: string,
  prefer: 'view' | 'worker',
): HTMLIFrameElement | null {
  const fallback = prefer === 'view' ? 'worker' : 'view';
  return (
    document.querySelector<HTMLIFrameElement>(
      `iframe[data-extension-id="${extensionId}"][data-role="${prefer}"]`,
    ) ??
    document.querySelector<HTMLIFrameElement>(
      `iframe[data-extension-id="${extensionId}"][data-role="${fallback}"]`,
    ) ??
    document.querySelector<HTMLIFrameElement>(
      `iframe[data-extension-id="${extensionId}"]`,
    )
  );
}
