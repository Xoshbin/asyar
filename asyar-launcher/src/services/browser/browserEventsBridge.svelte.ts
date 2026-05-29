import { createPushBridge } from '../eventPushBridge/createPushBridge';

/**
 * Bridges Rust-emitted `asyar:browser-event` Tauri events to extension
 * iframes. Rust emits one event per unique subscribed extension (per
 * tabs.snapshot / tabs.changed message from a paired browser); this bridge
 * looks up the iframe by `data-extension-id` and posts
 * `asyar:event:browser-event:push` — the wire type the SDK's
 * `BrowserServiceProxy.onTabsChanged` listens for via `MessageBroker.on(...)`.
 *
 * Thin wrapper over the shared [`createPushBridge`] factory — all
 * iframe-lookup / postMessage logic lives there, so this module is just a
 * configuration row, mirroring [`systemEventsBridge`].
 *
 * Permission enforcement happens at subscribe time in Rust
 * (`browser_events_subscribe` gated by `browser:tabs.read`), not here. If a
 * Tauri event arrives for an extension whose iframe is gone (uninstalled /
 * disabled mid-flight), the event is dropped silently.
 */
export const browserEventsBridge = createPushBridge(
  'asyar:browser-event',
  'asyar:event:browser-event:push',
  'browserEventsBridge',
);
