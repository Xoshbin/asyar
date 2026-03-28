/**
 * Returns the expected postMessage targetOrigin for a given extension iframe.
 *
 * On Windows, all extensions share the http://asyar-extension.localhost origin
 * (Tauri's workaround for custom schemes on Windows).
 * On macOS/Linux, each extension uses its own asyar-extension://{id} origin,
 * providing per-extension origin isolation.
 */
export function getExtensionFrameOrigin(extensionId: string): string {
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  return isWindows
    ? 'http://asyar-extension.localhost'
    : `asyar-extension://${extensionId}`;
}
