import { createPushBridge } from '../eventPushBridge/createPushBridge';

/**
 * Bridges Rust-emitted `asyar:system-event` Tauri events to extension
 * iframes. Rust emits one event per unique subscribed extension (per
 * platform-event dispatch); this bridge looks up the iframe by
 * `data-extension-id` and posts `asyar:event:system-event:push` — the
 * wire type the SDK's `SystemEventsServiceProxy` listens for via
 * `MessageBroker.on(...)`.
 *
 * Thin wrapper over the shared [`createPushBridge`] factory — all
 * iframe-lookup / postMessage logic lives there, so this module is just a
 * configuration row.
 *
 * If the target iframe is torn down (extension uninstalled/disabled
 * mid-flight), the event is dropped silently. Rust-side cleanup in
 * `lifecycle.rs` removes the subscription on uninstall, so this case is
 * racy but bounded.
 */
export const systemEventsBridge = createPushBridge(
  'asyar:system-event',
  'asyar:event:system-event:push',
  'systemEventsBridge',
);
