import { createPushBridge } from '../eventPushBridge/createPushBridge';

/**
 * Bridges Rust-emitted `asyar:application-index` Tauri events to extension
 * iframes.
 *
 * The Rust `index_events` hub fires whenever the application-index watcher
 * detects a change to `/Applications`, `/System/Applications`, or a
 * user-configured `additionalScanPaths` directory. After a debounced
 * rescan, the hub emits one Tauri event per unique subscribed extension;
 * this bridge looks up the target iframe by `data-extension-id` and posts
 * `asyar:event:application-index:push` — the wire type the SDK's
 * `ApplicationServiceProxy` listens for via `MessageBroker.on(...)`.
 *
 * Thin wrapper over the shared [`createPushBridge`] factory (same shape as
 * `appEventsBridge` / `systemEventsBridge`).
 */
export const indexEventsBridge = createPushBridge(
  'asyar:application-index',
  'asyar:event:application-index:push',
  'indexEventsBridge',
);
