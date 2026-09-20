import { ExtensionContext, type ExtensionContextCore } from 'asyar-sdk/contracts';

let explicitContext: ExtensionContextCore | undefined = undefined;

/**
 * Explicitly set or clear the active ExtensionContext (used by test runners,
 * custom wrappers, or iframe boots).
 */
export function setRaycastContext(ctx: ExtensionContextCore | undefined): void {
  explicitContext = ctx;
}

/**
 * Resolve the current active ExtensionContext.
 * Tries:
 * 1. Explicitly configured context via setRaycastContext
 * 2. globalThis.__ASYAR_EXTENSION_CONTEXT__
 * 3. Lazily created ExtensionContext with extensionId auto-resolved
 */
export function getActiveContext(): ExtensionContextCore {
  if (explicitContext) {
    return explicitContext;
  }

  const globalCtx = (globalThis as any).__ASYAR_EXTENSION_CONTEXT__;
  if (globalCtx) {
    return globalCtx as ExtensionContextCore;
  }

  // Create fallback context
  const newCtx = new ExtensionContext();
  const extId = resolveExtensionId();
  newCtx.setExtensionId(extId);

  (globalThis as any).__ASYAR_EXTENSION_CONTEXT__ = newCtx;
  return newCtx;
}

function resolveExtensionId(): string {
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === 'asyar-extension.localhost') {
      const seg = window.location.pathname.split('/').filter(Boolean)[0];
      if (seg) return seg;
    } else if (hostname) {
      return hostname;
    }
  }
  if (typeof process !== 'undefined' && process.env?.ASYAR_EXTENSION_ID) {
    return process.env.ASYAR_EXTENSION_ID;
  }
  return 'org.asyar.raycast-extension';
}
