#![allow(deprecated)]
use super::*;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, msg_send_id, sel};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use tauri_nspanel::{panel_delegate, Panel, WebviewWindowExt as PanelWebviewWindowExt};
use window_vibrancy::apply_vibrancy;

/// Configures a window to behave as a macOS Spotlight-style search bar.
pub fn setup_spotlight_window<R: Runtime>(
    window: &WebviewWindow<R>,
    app: &AppHandle<R>,
    theme_pref: crate::ThemePreference,
) -> tauri::Result<Panel> {
    let panel = window
        .to_panel()
        .map_err(|_| tauri::Error::FailedToReceiveMessage)?;

    // Panel levels and behaviors can be set via the Panel wrapper which handles the raw conversion
    panel.set_level(tauri_nspanel::cocoa::appkit::NSMainMenuWindowLevel + 1);
    // `set_collection_behaviour` only accepts a single variant, so OR the bits
    // straight onto the NSWindow (see `spotlight_collection_behavior_bits`).
    unsafe {
        let ns_window = window.ns_window().unwrap() as *mut AnyObject;
        let _: () = msg_send![
            ns_window,
            setCollectionBehavior: spotlight_collection_behavior_bits()
        ];
    }

    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);

    // Stops a stray app activation (`open -a Asyar`, Spotlight) from keying
    // the parked, invisible panel and swallowing keystrokes. The explicit
    // makeKeyWindow inside `panel.show()` is unaffected.
    panel.set_becomes_key_only_if_needed(true);

    let panel_delegate = panel_delegate!(SpotlightPanelDelegate {
        window_did_resign_key,
        window_did_become_key
    });

    let app_handle = app.clone();
    let label = window.label().to_string();
    panel_delegate.set_listener(Box::new(move |delegate_name: String| {
        match delegate_name.as_str() {
            "window_did_become_key" => {
                let _ = app_handle.emit(&format!("{}_panel_did_become_key", label), ());
            }
            "window_did_resign_key" => {
                let _ = app_handle.emit(&format!("{}_panel_did_resign_key", label), ());
            }
            _ => (),
        }
    }));
    panel.set_delegate(panel_delegate);

    let material = material_for_resolved_theme(resolve_theme_preference(theme_pref));
    apply_vibrancy(window, material, None, Some(15.0)).expect("Failed to apply vibrancy");

    // Seed the NSWindow appearance so the first composited frame already has
    // the correct blur tint — without this, a mismatch between Asyar's stored
    // theme and the OS appearance produces a washed-out panel on the very
    // first show. apply_panel_appearance is idempotent and no-ops on the
    // material if it was just set by apply_vibrancy above.
    apply_panel_appearance(window, theme_pref);

    // Persistent window/webview property; once per window lifetime is
    // enough. Pairs with the alpha-0 reveal in `prepare_show` (see the doc
    // comment on `disable_occlusion_detection` for why the two are halves
    // of the same anti-throttle strategy).
    disable_occlusion_detection(window);

    Ok(panel)
}

/// Collection-behavior bits applied to the launcher (spotlight) NSPanel.
///
/// The launcher is a non-activating panel, so `panel.show()` never activates
/// the app. CanJoinAllSpaces is what tells macOS the panel may appear on
/// whichever Space is currently active — without it the panel stays pinned to
/// the Space it was created on and the global shortcut always reopens it on
/// Desktop 1. FullScreenAuxiliary additionally lets it float over fullscreen
/// apps. Kept as a raw `u64` so the unit test can assert the exact bits
/// without AppKit being available (`cargo test` doesn't run inside an NSApp).
///
/// Under the parked lifecycle CanJoinAllSpaces is load-bearing: a parked
/// panel never re-orders in, so nothing else refreshes its Space assignment.
pub fn spotlight_collection_behavior_bits() -> u64 {
    // 1 << 0: NSWindowCollectionBehaviorCanJoinAllSpaces
    // 1 << 8: NSWindowCollectionBehaviorFullScreenAuxiliary
    (1 << 0) | (1 << 8)
}

/// Bit pattern applied to the HUD NSPanel. Kept as raw integers so the
/// unit test can assert the exact flag set without needing AppKit to be
/// available at test time (`cargo test` doesn't run inside an NSApp).
#[derive(Debug, Clone, Copy)]
pub struct HudPanelFlags {
    /// OR'd `NSWindowCollectionBehavior` bits.
    pub collection_behavior_bits: u64,
    /// `NSWindowStyleMask` value for the panel.
    pub style_mask: i32,
}

/// Returns the flag values used by [`setup_hud_window`]. The bits mirror
/// Apple's documented `NSWindowCollectionBehavior` and
/// `NSWindowStyleMask` constants — see the unit test for the contract.
pub fn hud_panel_flags() -> HudPanelFlags {
    // 1 << 0: NSWindowCollectionBehaviorCanJoinAllSpaces
    // 1 << 8: NSWindowCollectionBehaviorFullScreenAuxiliary
    let collection_behavior_bits: u64 = (1 << 0) | (1 << 8);
    // 1 << 7: NSWindowStyleMaskNonActivatingPanel
    let style_mask: i32 = 1 << 7;
    HudPanelFlags {
        collection_behavior_bits,
        style_mask,
    }
}

/// Configures the HUD window so it can appear over fullscreen apps
/// without stealing focus.
///
/// Ordinary Tauri windows with `alwaysOnTop: true` only elevate the
/// window level within the home Space — macOS refuses to float them
/// into a fullscreen Space. Converting the window to an NSPanel and
/// setting `NSWindowCollectionBehaviorFullScreenAuxiliary` is the
/// AppKit-sanctioned opt-in for Spotlight-style overlays. We pair it
/// with `CanJoinAllSpaces` (the HUD's `show()` doesn't activate, so
/// without this it would stay pinned to its home Space) and
/// `NSWindowStyleMaskNonActivatingPanel` (so showing the HUD never
/// kicks the fullscreen app out of fullscreen).
///
/// No delegate or vibrancy is attached — the HUD route renders its
/// own background and never needs to become key.
pub fn setup_hud_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Panel> {
    let panel = window
        .to_panel()
        .map_err(|_| tauri::Error::FailedToReceiveMessage)?;

    // One level above the launcher panel so a concurrently visible HUD
    // sits over the launcher (e.g. a long-running spinner HUD shown
    // while the launcher is also open).
    panel.set_level(tauri_nspanel::cocoa::appkit::NSMainMenuWindowLevel + 2);

    let flags = hud_panel_flags();

    // tauri_nspanel exposes the collection behavior as a typed enum, but
    // its `set_collection_behaviour` only accepts a single variant. Both
    // FullScreenAuxiliary and CanJoinAllSpaces must be set, so we go
    // straight to objc to OR the bits onto the underlying NSWindow.
    unsafe {
        let ns_window = window.ns_window().unwrap() as *mut AnyObject;
        let _: () = msg_send![
            ns_window,
            setCollectionBehavior: flags.collection_behavior_bits
        ];
    }

    panel.set_style_mask(flags.style_mask);

    Ok(panel)
}

/// Bit pattern applied to a sticky-note NSPanel. Raw integers so the unit
/// test can assert the exact flags without AppKit at test time.
#[derive(Debug, Clone, Copy)]
pub struct StickyPanelFlags {
    /// OR'd `NSWindowCollectionBehavior` bits.
    pub collection_behavior_bits: u64,
    /// `NSWindowStyleMask` value for the panel.
    pub style_mask: i32,
    /// `NSWindowLevel`. `cocoa::appkit` doesn't re-export
    /// `NSFloatingWindowLevel`, so the documented AppKit value is inlined —
    /// the same approach this file already takes for the style-mask bits.
    pub level: i32,
}

/// Flags used by [`setup_sticky_window`].
///
/// `NonActivatingPanel` is deliberate and is NOT a "cannot be focused" flag —
/// it means the panel takes keyboard focus *without activating the app*, which
/// is exactly how the launcher's own search field accepts typing. A sticky
/// needs the same: click it, type in it, without yanking app activation away
/// from whatever you were doing.
pub fn sticky_panel_flags() -> StickyPanelFlags {
    // 1 << 0: NSWindowCollectionBehaviorCanJoinAllSpaces — a sticky should be
    //         on whichever Space you're looking at, like a real sticky note.
    // 1 << 8: NSWindowCollectionBehaviorFullScreenAuxiliary — and visible over
    //         fullscreen apps.
    let collection_behavior_bits: u64 = (1 << 0) | (1 << 8);
    // `set_style_mask` REPLACES the mask, so the resizable bit has to be OR'd
    // back in — the builder's `.resizable(true)` is otherwise undone here and
    // the sticky becomes fixed-size.
    // 1 << 3: NSWindowStyleMaskResizable
    // 1 << 7: NSWindowStyleMaskNonActivatingPanel
    let style_mask: i32 = (1 << 3) | (1 << 7);
    // NSFloatingWindowLevel. Above ordinary app windows (NSNormalWindowLevel
    // = 0), far below the launcher panel (NSMainMenuWindowLevel = 24, +1) and
    // the HUD (+2) so summoning the launcher always overlays stickies.
    let level: i32 = 3;
    StickyPanelFlags {
        collection_behavior_bits,
        style_mask,
        level,
    }
}

/// Configures a sticky-note window: floats over other apps and across Spaces,
/// and can be typed into.
///
/// Level sits deliberately *below* both the launcher panel and the HUD (which
/// sit at `NSMainMenuWindowLevel` plus 1 and 2 respectively) — summoning the
/// launcher must still overlay every sticky, not duck underneath them.
///
/// Unlike the launcher this does NOT set `becomes_key_only_if_needed`: the
/// launcher uses that to stop a stray app activation from keying its parked,
/// invisible panel, whereas a sticky is a real visible window that should key
/// on click.
pub fn setup_sticky_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Panel> {
    let panel = window
        .to_panel()
        .map_err(|_| tauri::Error::FailedToReceiveMessage)?;

    let flags = sticky_panel_flags();
    panel.set_level(flags.level);
    unsafe {
        let ns_window = window.ns_window().unwrap() as *mut AnyObject;
        // Same reason as the launcher/HUD: `set_collection_behaviour` takes a
        // single variant, so OR the bits straight onto the NSWindow.
        let _: () = msg_send![
            ns_window,
            setCollectionBehavior: flags.collection_behavior_bits
        ];
        // Load-bearing: without this, closing a sticky aborts the whole app.
        // `releasedWhenClosed` defaults to YES, so AppKit deallocates the
        // NSWindow on close while tao still holds it — the next delegate
        // callback touches freed memory and raises an Obj-C exception, which
        // Rust cannot unwind ("Rust cannot catch foreign exceptions,
        // aborting"). Letting tao own the lifetime instead keeps close safe.
        let _: () = msg_send![ns_window, setReleasedWhenClosed: Bool::NO];
    }

    panel.set_style_mask(flags.style_mask);

    Ok(panel)
}

pub fn get_window_frame<R: Runtime>(window: &WebviewWindow<R>) -> NSRect {
    let window_handle = window.ns_window().unwrap() as *const AnyObject;
    unsafe { msg_send![window_handle, frame] }
}

pub fn set_window_frame<R: Runtime>(window: &WebviewWindow<R>, rect: NSRect) {
    let window_handle = window.ns_window().unwrap() as *const AnyObject;
    // animate: NO forces a zero-duration commit in the current CATransaction,
    // so the NSWindow doesn't run AppKit's default ~200ms resize animation.
    unsafe { msg_send![window_handle, setFrame: rect display: Bool::YES animate: Bool::NO] }
}

/// Sets the launcher panel's alphaValue.
///
/// Used by the show-reveal two-phase dance: `prepare_show` orders the panel
/// in at alpha 0 so WKWebView's WebContent process transitions back to the
/// `IsVisible` ActivityState and resumes pushing layer commits (after an
/// `orderOut:` it stops, and `orderFrontRegardless` would otherwise composite
/// the stale cached IOSurface from the prior session for 1–2 frames). The JS
/// side then awaits two rAFs so WebKit delivers a fresh commit, and
/// `commit_show` flips alpha to 1 — the user only sees the up-to-date frame.
pub fn set_window_alpha<R: Runtime>(window: &WebviewWindow<R>, alpha: f64) {
    let ns_window = window.ns_window().unwrap() as *mut AnyObject;
    unsafe {
        let _: () = msg_send![ns_window, setAlphaValue: alpha];
    }
}

/// `setIgnoresMouseEvents:` (public AppKit). A parked (alpha-0, ordered-in)
/// launcher must be click-transparent or it would invisibly swallow every
/// click landing inside its frame.
pub fn set_ignores_mouse_events<R: Runtime>(window: &WebviewWindow<R>, ignores: bool) {
    let ns_window = window.ns_window().unwrap() as *mut AnyObject;
    unsafe {
        let _: () = msg_send![ns_window, setIgnoresMouseEvents: ignores];
    }
}

/// Whether the launcher panel currently owns key focus. Decides the
/// focus-return branch in `park_launcher_panel`.
pub fn is_key_window<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let ns_window = match window.ns_window() {
        Ok(ptr) => ptr as *mut AnyObject,
        Err(_) => return false,
    };
    unsafe {
        let key: Bool = msg_send![ns_window, isKeyWindow];
        key.as_bool()
    }
}

/// Park the launcher into its "hidden" state: ordered in, alpha 0,
/// mouse-transparent, never key. The window stays on the screen list with
/// occlusion detection off (`disable_occlusion_detection`), so WebKit keeps
/// the WebContent process in the visible activity state the whole time:
/// timers tick at true cadence, post-hide state resets composite while
/// imperceptible, and the next reveal is an alpha flip of an already-fresh
/// surface with no stale frame and no cold WebContent wake-up.
///
/// Focus return: a programmatic hide (Escape, hotkey toggle) leaves the
/// nonactivating panel key, and the only way to hand focus back to the
/// previous app is `orderOut:`, so order out and immediately re-order in.
/// `orderFrontRegardless` is the one ordering call that works without
/// activating this (Accessory) app; front-of-level is imperceptible at
/// alpha 0. Click-away hides skip the dance: key focus already moved.
///
/// Reentrant: `orderOut:` fires the resign-key delegate synchronously and
/// that listener parks too; the nested call sees `is_key_window == false`
/// and only re-asserts alpha and mouse transparency. Main-thread only.
pub fn park_launcher_panel<R: Runtime>(window: &WebviewWindow<R>, panel: &Panel) {
    set_window_alpha(window, 0.0);
    set_ignores_mouse_events(window, true);
    if is_key_window(window) {
        panel.order_out(None);
        panel.order_front_regardless();
    }
}

/// Reveal a parked launcher. The order is load-bearing now that the window
/// is always mapped: accept mouse events; center *while still invisible*
/// (repositioning at alpha 1 would visibly jump); `panel.show()` to raise
/// and take key focus so a fast typist's keystrokes land in the DOM before
/// any pixels appear; alpha 0→1; then reseat the WKWebView as first
/// responder, since `panel.show()` on an already-visible panel doesn't
/// rebuild the responder chain and under this lifecycle every show is one.
pub fn reveal_launcher_panel<R: Runtime>(window: &WebviewWindow<R>, panel: &Panel) {
    set_ignores_mouse_events(window, false);
    if let Err(e) = position_launcher(window) {
        log::warn!(
            "[launcher-reveal] position_launcher failed: {e}; revealing at previous position"
        );
    }
    panel.show();
    set_window_alpha(window, 1.0);
    reseat_first_responder(window);
}

/// Parks the launcher at boot (it was created `visible: false`), so WebKit
/// pays the cold-start cost (first load, first paint, font fallback) while
/// the panel is imperceptible, and the first summon takes the same
/// alpha-flip path as every later one. `orderFrontRegardless` neither takes
/// key focus nor activates the app: no pixels, no clicks, no focus.
pub fn prewarm_launcher_panel<R: Runtime>(window: &WebviewWindow<R>, panel: &Panel) {
    set_window_alpha(window, 0.0);
    set_ignores_mouse_events(window, true);
    panel.order_front_regardless();
    log::info!("[launcher-park] prewarmed at boot (ordered in, alpha 0, mouse-transparent)");
}

/// True if `obj` responds to `selector`. Every semi-private AppKit/WebKit
/// selector below must be gated through this: an unrecognized selector
/// raises an ObjC exception (it is NOT a silent no-op), and these SPIs can
/// disappear or be renamed in any macOS release.
unsafe fn responds_to(obj: *mut AnyObject, selector: objc2::runtime::Sel) -> bool {
    if obj.is_null() {
        return false;
    }
    let ok: Bool = msg_send![obj, respondsToSelector: selector];
    ok.as_bool()
}

/// Disable occlusion-based render throttling for the launcher.
///
/// WebKit throttles rAF/CSS animations/timers when it decides the view isn't
/// visible, and an alpha-0 window reports itself as occluded. Disabling
/// occlusion detection keeps the webview unthrottled whenever the panel is
/// *ordered in*, which under the parked lifecycle (`park_launcher_panel`) is
/// the entire time the launcher is "hidden". It does not help an ordered-out
/// window (WebKit checks `window.isVisible` before occlusion), which is why
/// parking keeps the panel on the screen list.
///
/// Two flavors exist in the wild and both are semi-private, so each is
/// respondsToSelector-gated:
/// - `-[WKWebView _setWindowOcclusionDetectionEnabled:]` (WebKit SPI;
///   controls whether the web view folds the host window's occlusion
///   state into its view state)
/// - `-[NSWindow setWindowOcclusionDetectionEnabled:]` (AppKit-level toggle
///   present on some releases)
///
/// Scope strictly to the launcher panel: the HUD and settings windows are
/// transient/ordinary windows where default throttling-when-hidden is
/// desirable (saves power).
pub fn disable_occlusion_detection<R: Runtime>(window: &WebviewWindow<R>) {
    let ns_window = match window.ns_window() {
        Ok(ptr) => ptr as *mut AnyObject,
        Err(_) => {
            log::warn!("[occlusion] ns_window() failed; occlusion detection left enabled");
            return;
        }
    };
    unsafe {
        let mut applied: Vec<&str> = Vec::new();

        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        let webview = find_webview(content_view);
        if responds_to(webview, sel!(_setWindowOcclusionDetectionEnabled:)) {
            let _: () = msg_send![webview, _setWindowOcclusionDetectionEnabled: false];
            applied.push("WKWebView._setWindowOcclusionDetectionEnabled");
        }

        if responds_to(ns_window, sel!(setWindowOcclusionDetectionEnabled:)) {
            let _: () = msg_send![ns_window, setWindowOcclusionDetectionEnabled: false];
            applied.push("NSWindow.setWindowOcclusionDetectionEnabled");
        }

        if applied.is_empty() {
            log::warn!(
                "[occlusion] no occlusion-detection SPI responded; launcher webview \
                 stays subject to occlusion throttling"
            );
        } else {
            log::info!("[occlusion] disabled via {}", applied.join(" + "));
        }
    }
}

/// WebKit feature flags to set on the launcher's WKPreferences, keyed by
/// `_WKFeature.key` (as spelled in WebKit's UnifiedWebPreferences).
///
/// - `RequestIdleCallbackEnabled` on (the suffixless spelling covers
///   releases that renamed it): lets the launcher schedule non-critical
///   startup work (What's New check, telemetry, font prewarm) off the
///   critical path natively. `src/lib/idle.ts` ships a setTimeout
///   polyfill, so nothing *depends* on the flag landing; it only upgrades
///   the scheduling quality.
/// - `PreferPageRenderingUpdatesNear60FPSEnabled` off: WebKit otherwise
///   caps rendering updates near 60Hz even on ProMotion displays; lifting
///   the cap lets rAF-driven UI (scrolling, reveals, animations) track the
///   display's native cadence. Rendering stays demand-driven — a static
///   launcher produces no extra frames, so there is no idle power cost.
const WEBKIT_FEATURES_TO_SET: &[(&str, bool)] = &[
    ("RequestIdleCallbackEnabled", true),
    ("RequestIdleCallback", true),
    ("PreferPageRenderingUpdatesNear60FPSEnabled", false),
];

/// Flip WebKit runtime feature flags on the launcher webview (the same
/// flags Safari exposes in its Develop → Feature Flags menu).
///
/// Everything here is private SPI and version-fragile, so the whole walk is
/// defensive: enumerate whichever of `+[WKPreferences _features]` /
/// `_experimentalFeatures` / `_internalDebugFeatures` exists, match by key
/// string, no-op when absent, and log exactly what was flipped. Correctness
/// must never depend on a flag landing; JS guards + polyfills own that.
///
/// Call as early as possible after the webview exists (flags may only be
/// read at document setup, so late flips can silently not apply until the
/// next navigation).
pub fn configure_launcher_webkit_features<R: Runtime>(window: &WebviewWindow<R>) {
    let ns_window = match window.ns_window() {
        Ok(ptr) => ptr as *mut AnyObject,
        Err(_) => {
            log::warn!("[webkit-flags] ns_window() failed; feature flags left at defaults");
            return;
        }
    };
    unsafe {
        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        let webview = find_webview(content_view);
        if webview.is_null() {
            log::warn!("[webkit-flags] WKWebView not found in contentView subviews");
            return;
        }
        let config: *mut AnyObject = msg_send![webview, configuration];
        if config.is_null() {
            return;
        }
        let prefs: *mut AnyObject = msg_send![config, preferences];
        if !responds_to(prefs, sel!(_setEnabled:forFeature:)) {
            log::info!("[webkit-flags] _setEnabled:forFeature: SPI absent; skipping");
            return;
        }

        let Some(prefs_cls) = AnyClass::get("WKPreferences") else {
            return;
        };
        let cls_obj = prefs_cls as *const AnyClass as *mut AnyObject;

        let mut flipped: Vec<(String, bool)> = Vec::new();
        // The unified `_features` list superseded the experimental/internal
        // split; older releases only answer the latter two.
        for list_sel in [
            sel!(_features),
            sel!(_experimentalFeatures),
            sel!(_internalDebugFeatures),
        ] {
            if !responds_to(cls_obj, list_sel) {
                continue;
            }
            let list: *mut AnyObject = msg_send![cls_obj, performSelector: list_sel];
            if list.is_null() {
                continue;
            }
            let count: usize = msg_send![list, count];
            for i in 0..count {
                let feature: *mut AnyObject = msg_send![list, objectAtIndex: i];
                if !responds_to(feature, sel!(key)) {
                    continue;
                }
                let key_obj: Option<Retained<NSString>> = msg_send_id![feature, key];
                let Some(key) = key_obj.map(|k| k.to_string()) else {
                    continue;
                };
                let Some(&(_, enable)) = WEBKIT_FEATURES_TO_SET.iter().find(|(k, _)| *k == key)
                else {
                    continue;
                };
                if flipped.iter().any(|(k, _)| *k == key) {
                    continue;
                }
                let _: () = msg_send![prefs, _setEnabled: enable forFeature: feature];
                flipped.push((key, enable));
            }
        }

        if flipped.is_empty() {
            log::info!(
                "[webkit-flags] no matching feature flags found ({}); defaults stay",
                WEBKIT_FEATURES_TO_SET
                    .iter()
                    .map(|(k, _)| *k)
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        } else {
            log::info!(
                "[webkit-flags] set: {}",
                flipped
                    .iter()
                    .map(|(k, e)| format!("{k} {}", if *e { "on" } else { "off" }))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    }
}

/// Order `window` in imperceptibly (alpha 0) and reveal it only once WebKit
/// has actually presented a frame: `-[WKWebView _doAfterNextPresentationUpdate:]`
/// is WebKit's own "content is on glass" synchronization hook. Ordering in
/// at alpha 0 first is load-bearing: a hidden window's WebContent process is
/// throttled and may never present, so the callback would never fire.
///
/// Used for windows created cold at runtime (onboarding), where showing at
/// build time paints an empty/unstyled frame before the first WebKit commit,
/// and for re-showing long-hidden windows (settings), where the last
/// composite predates the hidden spell and paints stale for a frame or two.
/// The launcher keeps its own two-phase `prepare_show`/`commit_show` dance:
/// its reveal is gated on *content freshness* (JS-side rAFs), not merely
/// first paint, so don't swap that path onto this helper.
///
/// A `fallback_ms` watchdog guarantees the window can never get stuck
/// invisible if the SPI is absent or WebKit never presents (wedged
/// WebContent process): worst case is the pre-existing behavior, one
/// `fallback_ms` later.
pub fn reveal_window_after_first_paint<R: Runtime + 'static>(
    window: &WebviewWindow<R>,
    fallback_ms: u64,
) {
    let ns_window = match window.ns_window() {
        Ok(ptr) => ptr as *mut AnyObject,
        Err(_) => {
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }
    };

    let hooked = unsafe {
        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        let webview = find_webview(content_view);
        if responds_to(webview, sel!(_doAfterNextPresentationUpdate:)) {
            set_window_alpha(window, 0.0);
            let w = window.clone();
            let block = block2::RcBlock::new(move || {
                // Runs on the main thread (WebKit dispatches presentation
                // callbacks there). Idempotent with the watchdog below.
                set_window_alpha(&w, 1.0);
                let _ = w.set_focus();
            });
            // Register before ordering in, so the first present after the
            // show can't slip between the two and leave only the watchdog.
            let _: () = msg_send![webview, _doAfterNextPresentationUpdate: &*block];
            let _ = window.show();
            true
        } else {
            false
        }
    };

    if !hooked {
        // SPI absent: fall back to the plain visible-at-open behavior.
        log::info!("[first-paint] _doAfterNextPresentationUpdate absent; showing immediately");
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let w = window.clone();
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(fallback_ms)).await;
        let _ = app.run_on_main_thread(move || {
            if window_alpha(&w) < 1.0 {
                log::warn!(
                    "[first-paint] presentation update never fired within {fallback_ms}ms; \
                     revealing '{}' via watchdog",
                    w.label()
                );
                set_window_alpha(&w, 1.0);
                let _ = w.set_focus();
            }
        });
    });
}

/// Current alphaValue of the window (1.0 on handle failure, i.e. "treat as
/// already revealed"; every caller uses this to decide whether a reveal
/// watchdog still needs to run).
pub fn window_alpha<R: Runtime>(window: &WebviewWindow<R>) -> f64 {
    match window.ns_window() {
        Ok(ptr) => unsafe { msg_send![ptr as *mut AnyObject, alphaValue] },
        Err(_) => 1.0,
    }
}

/// Reseat the WKWebView as first responder. A `show` on an already-visible
/// panel doesn't run AppKit's responder reset, so a hotkey-driven extension
/// swap can leave the responder chain pointing at wry's parent view and
/// typed keys never reach the DOM.
pub fn reseat_first_responder<R: Runtime>(window: &WebviewWindow<R>) {
    let ns_window = window.ns_window().unwrap() as *mut AnyObject;
    unsafe {
        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        let webview = find_webview(content_view);
        if webview.is_null() {
            // find_webview identifies the WKWebView by the absence of the
            // vibrancy view's tag. A future wry/tauri version that adds
            // another sibling view would silently break the focus reseat
            // and the hotkey-swap focus bug would resurface — surface it.
            log::warn!("[reseat_first_responder] WKWebView not found in contentView subviews");
            return;
        }
        let _: Bool = msg_send![ns_window, makeFirstResponder: webview];
    }
}

/// Launcher heights — pinned at MAX, cropped to COMPACT by NSWindow resize.
/// Mirrors `LAUNCHER_HEIGHT_{DEFAULT,COMPACT}` in
/// `asyar-launcher/src/lib/launcher/launcherGeometry.ts`. The unit test
/// `heights_match_typescript_source` at the bottom of this file embeds the
/// TS source via `include_str!` and fails if these values drift.
pub const LAUNCHER_MAX_HEIGHT: f64 = 480.0;
pub const LAUNCHER_COMPACT_HEIGHT: f64 = 96.0;

/// Tag that window-vibrancy 0.6.x assigns to its NSVisualEffectView (see
/// window-vibrancy's internal.rs NS_VIEW_TAG_BLUR_VIEW). Used to tell the
/// vibrancy subview apart from the WKWebView in contentView.subviews.
const VIBRANCY_VIEW_TAG: i64 = 91376254;

unsafe fn find_subview(content_view: *mut AnyObject, match_vibrancy: bool) -> *mut AnyObject {
    let subviews: *mut AnyObject = msg_send![content_view, subviews];
    let count: usize = msg_send![subviews, count];
    for i in 0..count {
        let v: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
        let tag: i64 = msg_send![v, tag];
        if (tag == VIBRANCY_VIEW_TAG) == match_vibrancy {
            return v;
        }
    }
    std::ptr::null_mut()
}
unsafe fn find_webview(cv: *mut AnyObject) -> *mut AnyObject {
    find_subview(cv, false)
}
pub(super) unsafe fn find_vibrancy_view(cv: *mut AnyObject) -> *mut AnyObject {
    find_subview(cv, true)
}

/// Pin the WKWebView and vibrancy view at LAUNCHER_MAX_HEIGHT with height
/// auto-resizing off, so NSWindow resize only crops — AppKit's frame change
/// and WebKit's paint run on independent pipelines, so letting the webview
/// re-lay out produces a 1-frame interstitial.
pub fn pin_launcher_webview<R: Runtime>(window: &WebviewWindow<R>) {
    let nsw = window.ns_window().unwrap() as *mut AnyObject;
    unsafe {
        let content_view: *mut AnyObject = msg_send![nsw, contentView];
        let content_frame: NSRect = msg_send![content_view, frame];

        // Clip contentView to a rounded rect so all subviews share the same
        // mask — window_vibrancy only rounds the vibrancy view, and once the
        // webview is pinned on top its square corners cover vibrancy's.
        //
        // Must match the CSS shell radius (`--radius` shell / `:root`
        // border-radius in style.css). The webview paints the dark fill rounded
        // at that radius; if this clip is smaller, the fill recedes inside the
        // mask and each corner leaks a wallpaper crescent.
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content_view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: 20.0_f64];
            let _: () = msg_send![layer, setMasksToBounds: Bool::YES];
        }

        // NSViewWidthSizable = 2 (width stretches, height frozen).
        let pinned_frame = NSRect {
            origin: NSPoint { x: 0.0, y: 0.0 },
            size: NSSize {
                width: content_frame.size.width,
                height: LAUNCHER_MAX_HEIGHT,
            },
        };
        let webview = find_webview(content_view);
        if !webview.is_null() {
            let _: () = msg_send![webview, setAutoresizingMask: 2u64];
            let _: () = msg_send![webview, setFrame: pinned_frame];
        } else {
            log::warn!("[launcher-resize] WKWebView not found in contentView subviews");
        }

        // Default is Width|Height sizable — let it grow/shrink and the vibrancy
        // layer flashes before the webview repositions.
        let vibrancy = find_vibrancy_view(content_view);
        if !vibrancy.is_null() {
            let _: () = msg_send![vibrancy, setAutoresizingMask: 2u64];
            let _: () = msg_send![vibrancy, setFrame: pinned_frame];
        }
    }
}

#[derive(Clone, Copy)]
pub enum ResizeMode {
    Immediate,
    DeferToNextCaCommit,
    AfterNextPresentationUpdate,
}

/// Monotonic resize-request generation. Every `set_launcher_window_height`
/// call claims a new generation, and a commit whose generation has been
/// superseded by the time it fires (late CA pre-commit, late sentinel
/// match, watchdog) is dropped: the newest request owns the window. This
/// turns Escape-then-instant-reopen into "no visible resize at all" instead
/// of a 480→96→480 bounce. `cancel_pending_resize` claims a generation with
/// no successor, which withdraws an armed request outright.
static RESIZE_GEN: AtomicU64 = AtomicU64::new(0);

/// Highest generation whose content paint the webview has confirmed
/// (`confirm_launcher_paint`). A gated resize whose generation is already
/// confirmed at dispatch time skips the sentinel and joins the current
/// transaction directly (`set_launcher_window_height`'s fast path): the
/// swap is already applied, so there is no future commit to wait for.
static CONFIRMED_GEN: AtomicU64 = AtomicU64::new(0);

/// How long a presentation-gated resize waits for WebKit before the watchdog
/// force-applies the geometry. Sized for "WebContent is wedged", not "slow
/// frame": a heavy first mount can take >100ms to produce the paint the
/// resize must land with, and waiting for it is the point.
const GROW_WATCHDOG_MS: u64 = 250;

// ────────────────────────────────────────────────────────────────────────────
// The commit sentinel: how a gated resize lands in the SAME render-server
// commit as the webview paint it belongs to.
//
// Problem. A compact↔expanded transition swaps DOM chrome inside the already
// visible region (the Show More bar at the seam) at the same instant the
// NSWindow resizes. Unless both land in one render-server commit, one frame
// shows mismatched state (window tall + compact chrome, or cropped + stale
// pixels). AppKit-side content can join `setFrame:`'s CATransaction by
// construction; DOM content paints on WebKit's pipeline, so it needs the
// machinery below.
//
// Why presentation callbacks cannot do this:
// - `_doAfterNextPresentationUpdate:` fires after the paint is on glass, so
//   a resize committed from it trails the paint by one frame. Measured: the
//   mismatch is visible for exactly one 60fps frame.
// - `_doAfterNextPresentationUpdateWithoutWaitingForPainting:` fires inside
//   WebKit's commit-application callout. Mutating AppKit there (setFrame:)
//   crashes the WebContent process; deferring from it to pre-commit attaches
//   to the NEXT transaction, one frame late again. Both are dead ends.
//
// The two facts the sentinel is built on:
// 1. ORDERING. The frontend confirms the paint (`confirm_launcher_paint`)
//    from a rAF in the same rendering update that builds the swap, and
//    WebKit IPC is ordered per connection: the confirm message and the
//    swap's layer-tree commit leave the WebContent process in that order.
//    So when confirm runs in this process, every layer commit applied so
//    far is pre-swap, and the first one applied after it IS the swap.
// 2. UI-SIDE COMPOSITING. Modern macOS WKWebView uses remote layer trees:
//    the WebContent process sends layer-tree commits that the UI process
//    applies to real CALayers (contents = IOSurface refs) on the main
//    thread, inside ordinary CATransactions. That is what makes the swap
//    observable here at all, and what a `setFrame:` can join. Verified
//    empirically: the fingerprint below changes on the first transaction
//    after confirm, and resizing there yields adjacent-frame transitions
//    with no mismatch. If Apple ever moved compositing back out of the UI
//    process, the fingerprint would never change, the sentinel would never
//    fire, and the watchdog would degrade this to the old one-frame-late
//    behavior — worse, but never broken.
//
// Algorithm. When a gated resize is requested, stash the commit closure plus
// a fingerprint of the webview's layer subtree (contents pointers + sublayer
// counts). When confirm arrives, re-snapshot the fingerprint (any commit
// applied between request and confirm — a caret blink — is pre-swap by fact
// 1) and start watching: each main-runloop turn, register a handler for the
// pre-commit phase of that turn's implicit CATransaction. At pre-commit,
// layout is done and the transaction has not been handed to the render
// server; if the fingerprint changed, this transaction is the one applying
// the swap commit — run the resize right here and it ships in the same
// render-server commit as the new pixels. Unchanged → chain to the next
// turn. Mutating window geometry at pre-commit is the same mechanic as
// `DeferToNextCaCommit`, safely outside any WebKit callout.
//
// Recovery: generation supersession drops stale sentinels, the rounds cap
// bounds the watch, and the 250ms watchdog force-applies geometry if the
// paint never comes. Main-thread only.
// ────────────────────────────────────────────────────────────────────────────
struct SentinelPending {
    gen: u64,
    commit: Box<dyn Fn()>,
    webview: usize,
    fingerprint: std::cell::Cell<u64>,
    rounds: std::cell::Cell<u32>,
}

thread_local! {
    static SENTINEL: RefCell<Option<Rc<SentinelPending>>> = const { RefCell::new(None) };
}

extern "C" {
    static _dispatch_main_q: std::ffi::c_void;
    fn dispatch_async(queue: *const std::ffi::c_void, block: &block2::Block<dyn Fn()>);
}

/// Cheap structural hash of a layer subtree: contents pointers + sublayer
/// counts. A WebContent commit swaps tile contents, so the hash moves.
unsafe fn layer_tree_fingerprint(view: *mut AnyObject) -> u64 {
    unsafe fn walk(layer: *mut AnyObject, depth: u32, acc: &mut u64) {
        if layer.is_null() || depth > 8 {
            return;
        }
        let contents: *mut AnyObject = msg_send![layer, contents];
        *acc = acc.rotate_left(7) ^ (contents as u64);
        let subs: *mut AnyObject = msg_send![layer, sublayers];
        if subs.is_null() {
            return;
        }
        let count: usize = msg_send![subs, count];
        *acc = acc.rotate_left(3) ^ (count as u64);
        for i in 0..count {
            let sub: *mut AnyObject = msg_send![subs, objectAtIndex: i];
            walk(sub, depth + 1, acc);
        }
    }
    let layer: *mut AnyObject = msg_send![view, layer];
    let mut acc = 0u64;
    walk(layer, 0, &mut acc);
    acc
}

/// Registers a one-shot pre-commit handler on the current implicit
/// transaction; returns false when no transaction is active this turn.
fn try_register_pre_commit<F: Fn() + 'static>(f: F) -> bool {
    let block = block2::RcBlock::new(f);
    unsafe {
        let ca = AnyClass::get("CATransaction").expect("CATransaction class");
        let ok: Bool = msg_send![
            ca,
            addCommitHandler: &*block
            forPhase: CA_TRANSACTION_PHASE_PRE_COMMIT
        ];
        ok.as_bool()
    }
}

/// One round of the sentinel: attach to this turn's transaction; at
/// pre-commit compare the fingerprint; on change run the resize inside that
/// same transaction, else chain to the next turn.
fn sentinel_tick() {
    let Some(state) = SENTINEL.with(|s| s.borrow().clone()) else {
        return;
    };
    if RESIZE_GEN.load(Ordering::Acquire) != state.gen {
        SENTINEL.with(|s| *s.borrow_mut() = None);
        return;
    }
    if state.rounds.get() > 240 {
        log::warn!(
            "[launcher-resize] sentinel gave up after {} rounds (gen {})",
            state.rounds.get(),
            state.gen
        );
        SENTINEL.with(|s| *s.borrow_mut() = None);
        return;
    }
    state.rounds.set(state.rounds.get() + 1);
    let for_handler = state.clone();
    let registered = try_register_pre_commit(move || {
        if RESIZE_GEN.load(Ordering::Acquire) != for_handler.gen {
            SENTINEL.with(|s| *s.borrow_mut() = None);
            return;
        }
        let fp = unsafe { layer_tree_fingerprint(for_handler.webview as *mut AnyObject) };
        if fp != for_handler.fingerprint.get() {
            log::info!(
                "[launcher-resize] sentinel matched commit at round {} (gen {}); resizing in-transaction",
                for_handler.rounds.get(),
                for_handler.gen
            );
            (for_handler.commit)();
            SENTINEL.with(|s| *s.borrow_mut() = None);
        } else {
            sentinel_chain_next_turn();
        }
    });
    if !registered {
        sentinel_chain_next_turn();
    }
}

/// Re-enters `sentinel_tick` on the next main-runloop turn.
fn sentinel_chain_next_turn() {
    let block = block2::RcBlock::new(sentinel_tick);
    unsafe {
        dispatch_async(&_dispatch_main_q as *const std::ffi::c_void, &block);
    }
}

/// Marks the current generation's content as painted. The webview calls this
/// from a rAF in the same rendering update as the DOM swap: the IPC message
/// and the swap's layer-tree commit leave the WebContent process in that
/// order, so the mark lands here strictly before the swap commit is applied.
pub fn confirm_launcher_paint() {
    CONFIRMED_GEN.store(RESIZE_GEN.load(Ordering::Acquire), Ordering::Release);
    // The swap's layer-tree commit is ordered after this confirm on the
    // same IPC connection. Re-snapshot the fingerprint NOW (any commit
    // applied so far is pre-swap, e.g. a caret blink between send and
    // confirm), then watch per-turn transactions for the first post-confirm
    // layer change — that is the swap.
    let is_main: Bool = unsafe {
        let cls = AnyClass::get("NSThread").expect("NSThread class");
        msg_send![cls, isMainThread]
    };
    if is_main.as_bool() {
        SENTINEL.with(|s| {
            if let Some(p) = s.borrow().as_ref() {
                if RESIZE_GEN.load(Ordering::Acquire) == p.gen {
                    let fp = unsafe { layer_tree_fingerprint(p.webview as *mut AnyObject) };
                    p.fingerprint.set(fp);
                }
            }
        });
    }
    sentinel_chain_next_turn();
}

/// Withdraws the in-flight presentation-gated resize, if any: claims a new
/// generation with no successor, so an armed sentinel and its watchdog drop
/// via the generation check instead of eventually committing geometry the
/// frontend has moved past. Called when the frontend cancels a sent resize
/// whose confirm will never arrive (a reversal got deferred mid-transition).
pub fn cancel_pending_resize() {
    RESIZE_GEN.fetch_add(1, Ordering::AcqRel);
}

/// Atomically resize the NSWindow (top edge pinned) and reposition the pinned
/// webview + vibrancy layer: one main-thread turn, one CATransaction.
///
/// `DeferToNextCaCommit` attaches the resize to the current CA transaction's
/// pre-commit phase so it lands in the same render-server commit as WebKit's
/// pending paint.
///
/// `AfterNextPresentationUpdate` gates the resize on WebKit applying the
/// webview's next *confirmed* paint via the commit sentinel (see the block
/// above [`SentinelPending`]), so the window geometry and the new view's
/// pixels ship in one render-server commit. Every visible compact↔expanded
/// transition uses this: the Show More bar is DOM, so the paint the resize
/// must land with is also the paint that toggles the bar. An ungated grow
/// would show the new view's header through the compact crop for a frame or
/// two; an ungated shrink would show stale results pixels where the bar
/// belongs. A watchdog applies the resize anyway if the paint never comes.
pub fn set_launcher_window_height<R: Runtime + 'static>(
    window: &WebviewWindow<R>,
    height: f64,
    mode: ResizeMode,
) {
    // Cast through `usize` so the closure stays `Send` (raw pointers aren't);
    // the block only ever fires on the main thread.
    let nsw = window.ns_window().unwrap() as *mut AnyObject as usize;
    let gen = RESIZE_GEN.fetch_add(1, Ordering::AcqRel) + 1;

    let commit = move || unsafe {
        let current = RESIZE_GEN.load(Ordering::Acquire);
        if current != gen {
            log::info!(
                "[launcher-resize] gen {gen} superseded by {current}; dropping resize to {height}"
            );
            return;
        }
        let nsw = nsw as *mut AnyObject;
        let frame: NSRect = msg_send![nsw, frame];
        let new_y = frame.origin.y + frame.size.height - height;
        let new_frame = NSRect {
            origin: NSPoint {
                x: frame.origin.x,
                y: new_y,
            },
            size: NSSize {
                width: frame.size.width,
                height,
            },
        };
        // animate: NO — AppKit's default ~200ms resize animation would paint
        // interstitial frames instead of committing atomically below.
        let _: () = msg_send![nsw, setFrame: new_frame display: Bool::YES animate: Bool::NO];

        // origin.y is negative when compact (pinned view extends below the
        // cropped window), zero when expanded.
        let content_view: *mut AnyObject = msg_send![nsw, contentView];
        let new_origin_y = height - LAUNCHER_MAX_HEIGHT;

        for view in [find_webview(content_view), find_vibrancy_view(content_view)] {
            if view.is_null() {
                continue;
            }
            let f: NSRect = msg_send![view, frame];
            let new_f = NSRect {
                origin: NSPoint {
                    x: 0.0,
                    y: new_origin_y,
                },
                size: f.size,
            };
            let _: () = msg_send![view, setFrame: new_f];
        }
    };

    match mode {
        ResizeMode::Immediate => commit(),
        ResizeMode::DeferToNextCaCommit => schedule_on_next_pre_commit(commit),
        ResizeMode::AfterNextPresentationUpdate => {
            // A parked (alpha-0) window has no interstitial to prevent, and
            // the rAF-driven confirm can starve while it stays invisible.
            // Commit immediately; the reveal alpha-flips onto finished
            // geometry.
            if window_alpha(window) < 1.0 {
                commit();
                return;
            }
            // The caller requests the resize before its rendering update
            // builds the swap's paint and confirms from a rAF inside that
            // update. A confirm mark already set here means this dispatch
            // arrived late and the swap is already applied, so a hook would
            // wait on a present that static content never produces. Join the
            // current transaction instead: a truly late arrival costs one
            // frame instead of a watchdog timeout.
            if CONFIRMED_GEN.load(Ordering::Acquire) >= gen {
                log::info!("[launcher-resize] gen {gen} confirmed before dispatch; committing via CA pre-commit");
                schedule_on_next_pre_commit(commit);
                return;
            }
            let hooked = unsafe {
                let content_view: *mut AnyObject = msg_send![nsw as *mut AnyObject, contentView];
                let webview = find_webview(content_view);
                if !webview.is_null() {
                    // Stash the pending resize with a fingerprint of the
                    // webview's layer subtree; the confirm IPC starts a
                    // per-turn transaction watch that commits the resize
                    // inside the transaction applying the swap's layer-tree
                    // commit.
                    let fingerprint = layer_tree_fingerprint(webview);
                    let pending = Rc::new(SentinelPending {
                        gen,
                        commit: Box::new(commit),
                        webview: webview as usize,
                        fingerprint: std::cell::Cell::new(fingerprint),
                        rounds: std::cell::Cell::new(0),
                    });
                    SENTINEL.with(|s| *s.borrow_mut() = Some(pending));
                    true
                } else {
                    false
                }
            };
            if !hooked {
                log::info!("[launcher-resize] webview absent; falling back to CA pre-commit");
                schedule_on_next_pre_commit(commit);
                return;
            }
            // The watchdog advances the generation after a forced apply so
            // a late sentinel match drops via the generation check.
            let w = window.clone();
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(GROW_WATCHDOG_MS)).await;
                let _ = app.run_on_main_thread(move || {
                    if RESIZE_GEN.load(Ordering::Acquire) != gen {
                        return;
                    }
                    let Ok(ptr) = w.ns_window() else { return };
                    let frame: NSRect = unsafe { msg_send![ptr as *mut AnyObject, frame] };
                    if (frame.size.height - height).abs() > 0.5 {
                        log::warn!("[launcher-resize] gen {gen} never presented; watchdog applying -> {height}");
                        commit();
                        RESIZE_GEN.fetch_add(1, Ordering::AcqRel);
                    }
                });
            });
        }
    }
}

// +[CATransaction addCommitHandler:forPhase:] — SPI. kCATransactionPhasePreCommit
// fires after layout, before the transaction is handed to the render server,
// so mutations registered there land in the same transaction.
const CA_TRANSACTION_PHASE_PRE_COMMIT: i32 = 1;

type OnceSlot = Rc<RefCell<Option<Box<dyn FnOnce()>>>>;

/// Registers a one-shot pre-commit handler on the current CA transaction.
/// Falls back to invoking `f` synchronously if no transaction is active.
fn schedule_on_next_pre_commit<F: FnOnce() + 'static>(f: F) {
    let slot: OnceSlot = Rc::new(RefCell::new(Some(Box::new(f))));
    let for_block = slot.clone();
    let block = block2::RcBlock::new(move || {
        if let Some(f) = for_block.borrow_mut().take() {
            f();
        }
    });

    unsafe {
        let ca = AnyClass::get("CATransaction").expect("CATransaction class");
        let ok: Bool = msg_send![
            ca,
            addCommitHandler: &*block
            forPhase: CA_TRANSACTION_PHASE_PRE_COMMIT
        ];
        if !ok.as_bool() {
            if let Some(f) = slot.borrow_mut().take() {
                f();
            }
        }
    }
}

/// Places the launcher for a reveal, honouring the user's saved placement.
///
/// This used to be `center_at_cursor_monitor`, which hardcoded "centred on the
/// cursor's monitor, 16% down". That formula now lives — as the default —
/// in [`crate::launcher_placement::resolve`], alongside the drag position and
/// the Settings choices.
pub fn position_launcher<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<(), crate::error::AppError> {
    crate::launcher_placement::service::apply(window.app_handle())
}
#[cfg(test)]
mod tests {
    use super::*;

    /// The HUD window must appear over fullscreen apps and on whichever
    /// Space the user is currently on, without taking focus. That requires
    /// a specific bit pattern on the NSPanel: FullScreenAuxiliary +
    /// CanJoinAllSpaces in the collection behavior, plus the
    /// NonActivatingPanel style mask.
    ///
    /// Without FullScreenAuxiliary, macOS refuses to show the window on a
    /// fullscreen Space (the original bug). Without CanJoinAllSpaces, the
    /// HUD stays in its home Space because `window.show()` for the HUD
    /// doesn't activate the app. Without NonActivatingPanel, showing the
    /// HUD would kick a fullscreen app out of fullscreen.
    #[test]
    fn hud_panel_flags_include_fullscreen_auxiliary_and_can_join_all_spaces() {
        let flags = hud_panel_flags();

        // Apple NSWindowCollectionBehavior bit values:
        const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
        const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;
        const NON_ACTIVATING_PANEL: i32 = 1 << 7;

        assert!(
            flags.collection_behavior_bits & FULL_SCREEN_AUXILIARY != 0,
            "HUD must opt into NSWindowCollectionBehaviorFullScreenAuxiliary so it can appear over fullscreen apps (got bits={:#x})",
            flags.collection_behavior_bits,
        );
        assert!(
            flags.collection_behavior_bits & CAN_JOIN_ALL_SPACES != 0,
            "HUD must opt into NSWindowCollectionBehaviorCanJoinAllSpaces so it shows on whichever Space the user is currently on (got bits={:#x})",
            flags.collection_behavior_bits,
        );
        assert_eq!(
            flags.style_mask, NON_ACTIVATING_PANEL,
            "HUD style mask must be NSWindowStyleMaskNonActivatingPanel so showing it never steals focus from a fullscreen app",
        );
    }

    /// Sticky notes float across Spaces and over fullscreen apps, and are
    /// typable (NonActivatingPanel lets a panel take key focus *without*
    /// activating the app — it is not a "cannot be focused" flag).
    #[test]
    fn sticky_panel_flags_float_across_spaces_and_allow_typing() {
        let flags = sticky_panel_flags();

        const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
        const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;
        const RESIZABLE: i32 = 1 << 3;
        const NON_ACTIVATING_PANEL: i32 = 1 << 7;

        assert!(
            flags.collection_behavior_bits & CAN_JOIN_ALL_SPACES != 0,
            "a sticky should appear on whichever Space the user is on (got bits={:#x})",
            flags.collection_behavior_bits,
        );
        assert!(
            flags.collection_behavior_bits & FULL_SCREEN_AUXILIARY != 0,
            "a sticky should stay visible over fullscreen apps (got bits={:#x})",
            flags.collection_behavior_bits,
        );
        assert!(
            flags.style_mask & NON_ACTIVATING_PANEL != 0,
            "sticky takes key focus for typing without activating Asyar",
        );
        // `set_style_mask` replaces rather than merges, so losing this bit
        // silently undoes the builder's `.resizable(true)`.
        assert!(
            flags.style_mask & RESIZABLE != 0,
            "sticky must stay resizable after the panel conversion (got {:#x})",
            flags.style_mask,
        );
    }

    /// The launcher must always overlay stickies when summoned, so a sticky's
    /// window level has to stay below the launcher panel's.
    #[test]
    fn sticky_panel_level_sits_below_the_launcher_and_hud() {
        // Documented AppKit values (cocoa::appkit doesn't re-export them all).
        const NS_NORMAL_WINDOW_LEVEL: i32 = 0;
        const NS_MAIN_MENU_WINDOW_LEVEL: i32 = 24;
        let launcher_level = NS_MAIN_MENU_WINDOW_LEVEL + 1;
        let hud_level = NS_MAIN_MENU_WINDOW_LEVEL + 2;

        let sticky_level = sticky_panel_flags().level;

        assert!(
            sticky_level > NS_NORMAL_WINDOW_LEVEL,
            "a sticky must float above ordinary app windows (got {sticky_level})",
        );
        assert!(
            sticky_level < launcher_level,
            "summoning the launcher must overlay stickies (sticky={sticky_level}, launcher={launcher_level})",
        );
        assert!(
            sticky_level < hud_level,
            "the HUD must overlay stickies (sticky={sticky_level}, hud={hud_level})",
        );
    }

    /// Locks in the launcher panel's collection behavior: both
    /// CanJoinAllSpaces (follow the active Space) and FullScreenAuxiliary
    /// (float over fullscreen apps). See `spotlight_collection_behavior_bits`
    /// for why both are required.
    #[test]
    fn spotlight_panel_collection_behavior_joins_all_spaces() {
        let bits = spotlight_collection_behavior_bits();

        const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
        const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;

        assert!(
            bits & CAN_JOIN_ALL_SPACES != 0,
            "launcher panel must opt into NSWindowCollectionBehaviorCanJoinAllSpaces so it appears on whichever Space the user is currently on, not just its home Space (got bits={:#x})",
            bits,
        );
        assert!(
            bits & FULL_SCREEN_AUXILIARY != 0,
            "launcher panel must keep NSWindowCollectionBehaviorFullScreenAuxiliary so it can float over fullscreen apps (got bits={:#x})",
            bits,
        );
    }

    #[test]
    fn heights_match_typescript_source() {
        const TS_SRC: &str = include_str!("../../../../src/lib/launcher/launcherGeometry.ts");

        fn extract(src: &str, name: &str) -> f64 {
            let needle = format!("export const {name} = ");
            src.lines()
                .find_map(|line| {
                    line.trim()
                        .strip_prefix(&needle)
                        .and_then(|rest| rest.trim_end_matches(';').trim().parse::<f64>().ok())
                })
                .unwrap_or_else(|| panic!("`{name}` not found in launcherGeometry.ts"))
        }

        assert_eq!(
            LAUNCHER_MAX_HEIGHT,
            extract(TS_SRC, "LAUNCHER_HEIGHT_DEFAULT"),
            "LAUNCHER_MAX_HEIGHT (Rust) must match LAUNCHER_HEIGHT_DEFAULT (TS)"
        );
        assert_eq!(
            LAUNCHER_COMPACT_HEIGHT,
            extract(TS_SRC, "LAUNCHER_HEIGHT_COMPACT"),
            "LAUNCHER_COMPACT_HEIGHT (Rust) must match LAUNCHER_HEIGHT_COMPACT (TS)"
        );
    }
}
