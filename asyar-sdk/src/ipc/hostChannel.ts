/**
 * Realm-neutral access to the launcher host.
 *
 * An extension runs either in an iframe (has `window`, talks to
 * `window.parent`) or in a Web Worker (no `window`, talks through `self`).
 * Service proxies that listen for host messages or post to the host must use
 * these helpers instead of touching `window` directly, so they work in both.
 */

type MessageListener = (event: MessageEvent) => void;

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function';
}

/** Listens for messages sent by the host. Returns a function that stops listening. */
export function listenToHost(listener: MessageListener): () => void {
  if (hasWindow()) {
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }
  const scope = self as unknown as {
    addEventListener(type: 'message', cb: MessageListener): void;
    removeEventListener(type: 'message', cb: MessageListener): void;
  };
  scope.addEventListener('message', listener);
  return () => scope.removeEventListener('message', listener);
}

/** Posts a message to the host (iframe parent, or the worker's owner). */
export function postToHost(message: unknown): void {
  if (hasWindow()) {
    window.parent.postMessage(message, '*');
    return;
  }
  (self as unknown as { postMessage(message: unknown): void }).postMessage(message);
}
