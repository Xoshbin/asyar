import { createPushBridge } from '../eventPushBridge/createPushBridge';

/**
 * Bridges Rust-emitted `asyar:app-event` Tauri events to extension iframes.
 *
 * The Rust `app_events` hub emits one event per unique subscribed extension
 * whenever a GUI app is launched, terminated, or becomes frontmost; this
 * bridge looks up the target iframe by `data-extension-id` and posts
 * `asyar:event:app-event:push` — the wire type the SDK's
 * `ApplicationServiceProxy` listens for via `MessageBroker.on(...)`.
 *
 * Thin wrapper over the shared [`createPushBridge`] factory (same shape as
 * `systemEventsBridge`).
 */
export const appEventsBridge = createPushBridge(
  'asyar:app-event',
  'asyar:event:app-event:push',
  'appEventsBridge',
);
