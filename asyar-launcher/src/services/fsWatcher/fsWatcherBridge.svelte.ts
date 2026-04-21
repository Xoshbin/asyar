import { createPushBridge } from '../eventPushBridge/createPushBridge';

/**
 * Bridges Rust-emitted `asyar:fs-watch` Tauri events to extension iframes.
 *
 * The Rust `FsWatcherRegistry` fires whenever a debouncer callback sees
 * activity under an extension's watched roots (roots-up coalesced — the
 * raw per-file notify events never cross this boundary). The emitter
 * wired in `lib.rs::setup_app` emits one Tauri event per coalesced batch;
 * this bridge looks up the target iframe by `data-extension-id` and posts
 * `asyar:event:fs-watch:push` — the wire type the SDK's
 * `FileSystemWatcherServiceProxy` listens for via `MessageBroker.on(...)`.
 *
 * Thin wrapper over the shared [`createPushBridge`] factory (same shape
 * as `appEventsBridge` / `systemEventsBridge` / `indexEventsBridge`).
 */
export const fsWatcherBridge = createPushBridge(
  'asyar:fs-watch',
  'asyar:event:fs-watch:push',
  'fsWatcherBridge',
);
