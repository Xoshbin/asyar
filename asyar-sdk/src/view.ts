/**
 * asyar-sdk/view — UI-capable entry for view-context extension code.
 *
 * Asserts `window.__ASYAR_ROLE__ === "view"` at module load, before any
 * proxy is instantiated. Mis-imports fail fast with a clear message.
 *
 * Re-exports the full SDK surface: every service proxy, DOM helpers
 * (icon custom element, theme injector), search utilities, and
 * ExtensionContext bound to the full proxy bag.
 */

if (
  typeof window === 'undefined' ||
  (window as { __ASYAR_ROLE__?: unknown }).__ASYAR_ROLE__ !== 'view'
) {
  throw new Error(
    '[asyar-sdk/view] Imported outside a view context. ' +
      'This entry point is intended for code running in view.html ' +
      "(a Tier 2 extension's UI iframe). " +
      'Did you mean to import from "asyar-sdk/worker"?',
  );
}

import { SearchBarAccessoryServiceProxy } from './services/SearchBarAccessoryServiceProxy';

/**
 * Searchbar accessory singleton — view-mode-only. Use from a Tier 2
 * extension's view bundle to declare dropdown options at runtime and
 * receive `filterChange` notifications when the user picks an option
 * (or when the launcher seeds the value on view mount).
 */
export const searchBarAccessory = new SearchBarAccessoryServiceProxy();

/**
 * Keyboard event payload forwarded from the launcher search bar to the
 * active view iframe via `asyar:view:keydown`.
 */
export interface ViewKeyEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Subscribe to search query updates forwarded from the launcher search bar
 * (`asyar:view:search`). Returns an unsubscribe function.
 */
export function onSearch(cb: (query: string) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source && event.source !== window.parent) return;
    const data = event.data as { type?: unknown; payload?: { query?: unknown } } | null;
    if (!data || data.type !== 'asyar:view:search') return;
    if (typeof data.payload?.query === 'string') {
      cb(data.payload.query);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/**
 * Subscribe to keydown events forwarded from the launcher search bar
 * (`asyar:view:keydown`). Returns an unsubscribe function.
 */
export function onKey(cb: (event: ViewKeyEvent) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source && event.source !== window.parent) return;
    const data = event.data as { type?: unknown; payload?: Partial<ViewKeyEvent> } | null;
    if (!data || data.type !== 'asyar:view:keydown') return;
    const payload = data.payload;
    if (payload && typeof payload.key === 'string') {
      cb({
        key: payload.key,
        shiftKey: Boolean(payload.shiftKey),
        ctrlKey: Boolean(payload.ctrlKey),
        metaKey: Boolean(payload.metaKey),
        altKey: Boolean(payload.altKey),
      });
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export * from './contracts';
