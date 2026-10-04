/**
 * Prefer the given role's iframe, fall back to the other role, then to an
 * unscoped selector. Without this, an unfiltered `iframe[data-extension-id]`
 * selector hits whichever iframe comes first in DOM order (typically the
 * view) and a message meant for a worker-only handler vanishes silently.
 *
 * Use only for iframe-specific operations (focus, readiness, visual views).
 * Host-to-extension messages must use postToExtension in extensionDelivery,
 * which also supports Web Workers. Worker iframe compatibility remains here.
 */
export function pickExtensionIframe(
  extensionId: string,
  prefer: 'view' | 'worker',
  options: { fallback?: boolean } = {},
): HTMLIFrameElement | null {
  const preferred = document.querySelector<HTMLIFrameElement>(
    `iframe[data-extension-id="${extensionId}"][data-role="${prefer}"]`,
  );
  if (preferred || options.fallback === false) return preferred;

  const fallback = prefer === 'view' ? 'worker' : 'view';
  return (
    document.querySelector<HTMLIFrameElement>(
      `iframe[data-extension-id="${extensionId}"][data-role="${fallback}"]`,
    ) ?? document.querySelector<HTMLIFrameElement>(`iframe[data-extension-id="${extensionId}"]`)
  );
}
