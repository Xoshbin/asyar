import * as fs from 'fs';

/**
 * Launcher version that removes the iframe compatibility fallback.
 *
 * A worker bundle that still depends on the DOM runs on that fallback today
 * and stops working once it is gone. Kept in sync by hand with the
 * `remove in 0.2.0` marker in `workerHost.svelte.ts` and the guard test in
 * `asyar-launcher/src/services/extension/workerFallbackDeadline.test.ts`.
 */
export const WORKER_FALLBACK_REMOVED_IN = '0.2.0';

/**
 * Vite injects its modulepreload polyfill into an HTML entry chunk unless
 * `build.modulePreload` is false. The polyfill reads `document` on its first
 * line, so it throws immediately inside a Web Worker and takes the extension's
 * background script down with it.
 *
 * This selector is emitted *only* by that polyfill: Vite's other preload
 * helper (`__vitePreload`) guards its DOM access with
 * `typeof document !== "undefined"` and never queries for link elements. The
 * marker is a string literal, so it survives minification unchanged.
 */
const POLYFILL_MARKER = 'link[rel="modulepreload"]';

/**
 * Whether a built worker entry carries the DOM-dependent modulepreload
 * polyfill. Reads the entry chunk only — that is where Vite injects it.
 * Unreadable files report `false`: this is advisory, and a build problem is
 * already reported by the caller.
 */
export function workerBundleNeedsDomFallback(entryFile: string): boolean {
  try {
    return fs.readFileSync(entryFile, 'utf-8').includes(POLYFILL_MARKER);
  } catch {
    return false;
  }
}

/** The deprecation notice shown by `asyar build` and `asyar doctor`. */
export function workerCompatWarning(relativeEntry: string): string {
  return (
    `${relativeEntry} bundles Vite's modulepreload polyfill, which reads \`document\` ` +
    `and cannot run in a Web Worker.\n` +
    `     The launcher falls back to an iframe for now, but that fallback is removed in ` +
    `launcher ${WORKER_FALLBACK_REMOVED_IN}.\n` +
    `     Fix: depend on asyar-sdk@^4.14.0 and build with \`defineExtensionConfig\` from ` +
    `"asyar-sdk/vite", or set \`build.modulePreload: false\` in vite.config.ts yourself.`
  );
}
