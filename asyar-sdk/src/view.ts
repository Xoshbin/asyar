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
    '(a Tier 2 extension\'s UI iframe). ' +
    'Did you mean to import from "asyar-sdk/worker"?',
  );
}

export * from './contracts';
