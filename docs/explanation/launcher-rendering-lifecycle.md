---
order: 11
---

# Launcher Rendering Lifecycle (macOS)

The launcher is a WKWebView inside a non-activating `NSPanel`. Feeling native rather than web-based comes down to one rule: the NSWindow and the web content must never update out of step. WebKit renders in a separate WebContent process and pushes finished frames to the UI process asynchronously, so any naive combination of "resize the window" and "swap the DOM" produces visible interstitials: stale frames, blank regions, or one frame of new content cropped by old geometry. This page describes the mechanisms that prevent that, in the order they build on each other. The implementation lives in `src-tauri/src/platform/macos.rs` with the JS half in `src/services/launcher/compactSyncService.svelte.ts`.

## 1. Fixed-size webview, cropped window

The WKWebView and its vibrancy backdrop are pinned at the launcher's maximum height (480). Compact mode does not resize them; it crops the NSWindow to 96 with the top edge pinned (`set_launcher_window_height`). Expanding and collapsing therefore never trigger a WebKit relayout or repaint: WebKit keeps compositing the full 480 surface and the window reveals a sub-rect of an already-composited layer. This is what makes a height change _capable_ of being instant; the sections below make it _atomic_. The Show More bar is a native `NSView` (not DOM), repositioned and toggled inside the same `CATransaction` as every window resize, so bar and window can never disagree for a frame.

## 2. Keeping WebKit unthrottled

WebKit throttles `requestAnimationFrame`, CSS animations, and DOM timers whenever it decides a view isn't visible, and an alpha-0 window reports itself as _occluded_. Window-lifetime settings applied at boot remove that failure mode — and lift WebKit's default rendering ceiling:

- **Occlusion detection off** (`-[WKWebView _setWindowOcclusionDetectionEnabled:]`, plus an NSWindow-level spelling present on some releases; both `respondsToSelector`-gated). With detection disabled, WebKit treats the panel as visible whenever it is _ordered in_, regardless of alpha.
- **`requestIdleCallback` enabled** via WebKit's feature-flag SPI, with a JS polyfill installed at boot (`src/lib/idle.ts`) so idle-time scheduling exists even if the flag SPI disappears.
- **The ~60 fps rendering-update cap lifted** (`PreferPageRenderingUpdatesNear60FPSEnabled` off, via the same feature-flag SPI): rAF-driven UI tracks ProMotion displays at native cadence. Rendering stays demand-driven, so a static launcher draws no extra frames.

Every semi-private selector in the file is gated through `responds_to` (an unrecognized ObjC selector raises rather than no-ops), and each has a public-API fallback path.

## 3. The parked panel

"Hidden" does not mean `orderOut:`. A hidden launcher is **parked**: still ordered in, `alphaValue = 0`, `ignoresMouseEvents = YES`, never key (`becomesKeyOnlyIfNeeded`). Combined with occlusion-off, the WebContent process stays in the visible activity state the entire time the launcher is "hidden":

- Extension timers tick at true cadence while hidden.
- The frontend's post-hide state reset (`hideWindow().then(resetLauncherState)`) and the resign-key geometry collapse composite while imperceptible.
- The next summon is a pure alpha 0→1 flip of an already-fresh surface: no stale frame, no cold WebContent wake-up. `prewarm_launcher_panel` parks the panel at boot, so even the first summon takes this path.

The lifecycle has a few load-bearing constraints:

- **`CanJoinAllSpaces` is required.** A parked panel never re-orders in, so nothing refreshes its Space assignment; without this collection-behavior bit, summoning from another Space shows nothing.
- **Focus return still needs `orderOut:`.** A programmatic hide (Escape, hotkey toggle) leaves the non-activating panel key, and AppKit has no supported way to resign key "in place", so `park_launcher_panel` orders out (focus returns to the previous app) and immediately re-orders in with `orderFrontRegardless`, the one ordering call that works without activating an Accessory app. `orderOut:` fires the resign-key delegate _synchronously_, and that listener parks too, so the function is written to be reentrant.
- **Visibility is a logical flag.** `panel.is_visible()` is always true when parked; the hotkey toggle and `is_visible` command branch on `AppState::asyar_visible` instead (`commands/shortcuts.rs`).
- **Reveal order matters** (`reveal_launcher_panel`): accept mouse events, center on the cursor's monitor _while still invisible_, `panel.show()` to take key focus (so a fast typist's keystrokes land in the DOM before any pixels appear), alpha flip, then explicitly reseat the WKWebView as first responder; `panel.show()` on an already-visible panel doesn't rebuild the responder chain.

Summons that swap the view before revealing (user-item hotkeys) keep the older two-phase reveal: `prepare_show` (alpha 0, take key), two rAFs in JS so the _new_ view has committed a fresh frame, then `commit_show` (center, alpha 1, reseat responder).

## 4. Atomic height changes

Cropping solves repaints, but transitions that change _both_ the window height and the visible chrome (entering an extension view from compact, Escape back out) still race: the DOM swap and the `setFrame:` land in different render-server commits unless forced together. `set_launcher_window_height` takes a `ResizeMode`:

- **`Immediate`** — plain `setFrame:` on the main thread. Used while parked (nothing is visible) and at boot.
- **`DeferToNextCaCommit`** — attaches the resize to the current CA transaction's pre-commit phase, so it lands in the same render-server commit as WebKit's pending paint. Used for the goBack _shrink_: the crop only hides the results region, so resizing as early as possible is correct.
- **`AfterNextPresentationUpdate`** — gates the resize on WebKit actually applying the new content's paint in the UI process. Used for the _grow_ into an extension view, where an ungated resize shows the new view's header through the compact crop for a frame or two.

The grow gate is a small handshake between JS and Rust, built on `_doAfterNextPresentationUpdate:` (the same SPI [Raycast's technical deep-dive](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast) describes using for flash-free reveals):

1. `compactSyncService` sends the grow request at `$effect` time, _before_ the rendering update that builds the swap's paint, so the Rust-side hook is armed ahead of the swap's layer-tree commit and cannot miss it.
2. From a rAF in that same rendering update, JS calls `confirm_launcher_paint`. The IPC message and the swap's layer-tree commit leave the WebContent process in that order, so the confirm mark is set before the swap's presentation callback fires.
3. The armed hook fires on each presentation update; presents that predate the confirm mark (a caret blink already in flight) re-arm it, and the confirmed present commits the window resize + Show More bar toggle in the same transaction as the new view's pixels.

Three fallbacks keep the gate from ever wedging: if the request arrives with the confirm mark already set (late dispatch on a busy main thread), it joins the current CA transaction instead of waiting for a present that static content will never produce; if the window is parked, it commits ungated (presentation callbacks starve at alpha 0); and a 250 ms watchdog (sized for "WebContent is wedged", not "slow first mount") force-applies the geometry if WebKit never presents.

Every resize request claims a **generation** (`RESIZE_GEN`), and any gated commit whose generation has been superseded by the time it fires is dropped. That is what makes rapid open/Escape/open cycles stable: an obsolete shrink arriving after a newer grow is discarded, so the window shows no resize at all instead of a 480→96→480 bounce. The JS side mirrors this with armed-target bookkeeping (`#pendingTarget`) and re-derives the target height when a scheduled resize actually fires, so schedules from transient state blips drop out instead of committing stale heights. Withdrawal is the same mechanism without a successor: when a deferred reversal cancels a sent grow's confirm before it fires, `cancel_launcher_resize` claims a fresh generation, the armed hook and its watchdog drop, and the settled state re-derives the geometry from scratch — geometry never moves except in sync with a request that still describes the current UI.
