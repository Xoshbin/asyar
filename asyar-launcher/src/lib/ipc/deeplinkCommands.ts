import { invokeSafe } from './invokeSafe';

// Silent: appInitializer.ts is the sole caller. Drains any asyar:// link that
// cold-started the app; Rust re-emits it through the normal deep-link events
// now that the extension/auth/OAuth listeners are registered.
export function flushPendingDeeplinks(): Promise<null> {
  return invokeSafe('flush_pending_deeplinks', undefined, { silent: true });
}
