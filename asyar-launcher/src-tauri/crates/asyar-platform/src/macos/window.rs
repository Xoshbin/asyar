#![allow(deprecated)]
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, msg_send_id, sel};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

pub fn spotlight_collection_behavior_bits() -> u64 {
    // 1 << 0: NSWindowCollectionBehaviorCanJoinAllSpaces
    // 1 << 8: NSWindowCollectionBehaviorFullScreenAuxiliary
    (1 << 0) | (1 << 8)
}

#[derive(Debug, Clone, Copy)]
pub struct HudPanelFlags {
    pub collection_behavior_bits: u64,
    pub style_mask: i32,
}

pub fn hud_panel_flags() -> HudPanelFlags {
    let collection_behavior_bits: u64 = (1 << 0) | (1 << 8);
    let style_mask: i32 = 1 << 7;
    HudPanelFlags {
        collection_behavior_bits,
        style_mask,
    }
}

#[derive(Debug, Clone, Copy)]
pub struct StickyPanelFlags {
    pub collection_behavior_bits: u64,
    pub style_mask: i32,
    pub level: i32,
}

pub fn sticky_panel_flags() -> StickyPanelFlags {
    let collection_behavior_bits: u64 = (1 << 0) | (1 << 8);
    let style_mask: i32 = (1 << 7) | (1 << 3);
    const NS_FLOATING_WINDOW_LEVEL: i32 = 3;
    StickyPanelFlags {
        collection_behavior_bits,
        style_mask,
        level: NS_FLOATING_WINDOW_LEVEL,
    }
}

/// Applies collection behavior bits for Spotlight window to the given NSWindow.
///
/// # Safety
/// `ns_window` must be either null or a valid pointer to an `NSWindow` instance.
pub unsafe fn apply_spotlight_window_styling(ns_window: *mut AnyObject) {
    if ns_window.is_null() {
        return;
    }
    let _: () = msg_send![
        ns_window,
        setCollectionBehavior: spotlight_collection_behavior_bits()
    ];
}

/// # Safety
/// `ns_window` must be a valid, non-null pointer to an `NSWindow` instance.
pub unsafe fn get_window_frame(ns_window: *mut AnyObject) -> NSRect {
    msg_send![ns_window, frame]
}

/// # Safety
/// `ns_window` must be a valid, non-null pointer to an `NSWindow` instance.
pub unsafe fn set_window_frame(ns_window: *mut AnyObject, rect: NSRect) {
    msg_send![ns_window, setFrame: rect display: Bool::YES animate: Bool::NO]
}

/// # Safety
/// `ns_window` must be a valid, non-null pointer to an `NSWindow` instance.
pub unsafe fn set_window_alpha(ns_window: *mut AnyObject, alpha: f64) {
    let _: () = msg_send![ns_window, setAlphaValue: alpha];
}

/// # Safety
/// `ns_window` must be either null or a valid pointer to an `NSWindow` instance.
pub unsafe fn get_window_alpha(ns_window: *mut AnyObject) -> f64 {
    if ns_window.is_null() {
        return 1.0;
    }
    msg_send![ns_window, alphaValue]
}

/// # Safety
/// `ns_window` must be a valid, non-null pointer to an `NSWindow` instance.
pub unsafe fn set_ignores_mouse_events(ns_window: *mut AnyObject, ignores: bool) {
    let _: () = msg_send![ns_window, setIgnoresMouseEvents: ignores];
}

/// # Safety
/// `ns_window` must be either null or a valid pointer to an `NSWindow` instance.
pub unsafe fn is_key_window(ns_window: *mut AnyObject) -> bool {
    if ns_window.is_null() {
        return false;
    }
    let key: Bool = msg_send![ns_window, isKeyWindow];
    key.as_bool()
}

/// # Safety
/// `ns_window` must be either null or a valid pointer to an `NSWindow` instance.
pub unsafe fn park_launcher_window(ns_window: *mut AnyObject) {
    set_window_alpha(ns_window, 0.0);
    set_ignores_mouse_events(ns_window, true);
    if is_key_window(ns_window) {
        let _: () = msg_send![ns_window, orderOut: std::ptr::null::<AnyObject>()];
        let _: () = msg_send![ns_window, orderFrontRegardless];
    }
}

/// # Safety
/// `ns_window` must be a valid, non-null pointer to an `NSWindow` instance.
pub unsafe fn reveal_launcher_window(ns_window: *mut AnyObject) {
    set_ignores_mouse_events(ns_window, false);
    let _: () = msg_send![ns_window, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
    set_window_alpha(ns_window, 1.0);
    reseat_first_responder(ns_window);
}

/// # Safety
/// `ns_window` must be a valid, non-null pointer to an `NSWindow` instance.
pub unsafe fn prewarm_launcher_window(ns_window: *mut AnyObject) {
    set_window_alpha(ns_window, 0.0);
    set_ignores_mouse_events(ns_window, true);
    let _: () = msg_send![ns_window, orderFrontRegardless];
    log::info!("[launcher-park] prewarmed at boot (ordered in, alpha 0, mouse-transparent)");
}

unsafe fn responds_to(obj: *mut AnyObject, selector: objc2::runtime::Sel) -> bool {
    if obj.is_null() {
        return false;
    }
    let ok: Bool = msg_send![obj, respondsToSelector: selector];
    ok.as_bool()
}

/// # Safety
/// `ns_window` must be either null or a valid pointer to an `NSWindow` instance.
pub unsafe fn disable_occlusion_detection(ns_window: *mut AnyObject) {
    if ns_window.is_null() {
        return;
    }
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
            "[occlusion] no occlusion-detection SPI responded; launcher webview stays subject to occlusion throttling"
        );
    } else {
        log::info!("[occlusion] disabled via {}", applied.join(" + "));
    }
}

const WEBKIT_FEATURES_TO_SET: &[(&str, bool)] = &[
    ("RequestIdleCallbackEnabled", true),
    ("RequestIdleCallback", true),
    ("PreferPageRenderingUpdatesNear60FPSEnabled", false),
];

/// # Safety
/// `ns_window` must be either null or a valid pointer to an `NSWindow` instance.
pub unsafe fn configure_launcher_webkit_features(ns_window: *mut AnyObject) {
    if ns_window.is_null() {
        return;
    }
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
            let Some(&(_, enable)) = WEBKIT_FEATURES_TO_SET.iter().find(|(k, _)| *k == key) else {
                continue;
            };
            if flipped.iter().any(|(k, _)| *k == key) {
                continue;
            }
            let _: () = msg_send![prefs, _setEnabled: enable forFeature: feature];
            flipped.push((key, enable));
        }
    }

    if !flipped.is_empty() {
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

/// # Safety
/// `ns_window` must be either null or a valid pointer to an `NSWindow` instance.
pub unsafe fn reseat_first_responder(ns_window: *mut AnyObject) {
    if ns_window.is_null() {
        return;
    }
    let content_view: *mut AnyObject = msg_send![ns_window, contentView];
    let webview = find_webview(content_view);
    if webview.is_null() {
        log::warn!("[reseat_first_responder] WKWebView not found in contentView subviews");
        return;
    }
    let _: Bool = msg_send![ns_window, makeFirstResponder: webview];
}

pub const LAUNCHER_MAX_HEIGHT: f64 = 480.0;
pub const LAUNCHER_COMPACT_HEIGHT: f64 = 96.0;

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

/// # Safety
/// `cv` must be either null or a valid pointer to an `NSView` instance.
pub unsafe fn find_webview(cv: *mut AnyObject) -> *mut AnyObject {
    find_subview(cv, false)
}

/// # Safety
/// `cv` must be either null or a valid pointer to an `NSView` instance.
pub unsafe fn find_vibrancy_view(cv: *mut AnyObject) -> *mut AnyObject {
    find_subview(cv, true)
}

/// # Safety
/// `ns_window` must be either null or a valid pointer to an `NSWindow` instance.
pub unsafe fn pin_launcher_webview(ns_window: *mut AnyObject) {
    if ns_window.is_null() {
        return;
    }
    let content_view: *mut AnyObject = msg_send![ns_window, contentView];
    let content_frame: NSRect = msg_send![content_view, frame];

    let _: () = msg_send![content_view, setWantsLayer: true];
    let layer: *mut AnyObject = msg_send![content_view, layer];
    if !layer.is_null() {
        let _: () = msg_send![layer, setCornerRadius: 20.0_f64];
        let _: () = msg_send![layer, setMasksToBounds: Bool::YES];
    }

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

    let vibrancy = find_vibrancy_view(content_view);
    if !vibrancy.is_null() {
        let _: () = msg_send![vibrancy, setAutoresizingMask: 2u64];
        let _: () = msg_send![vibrancy, setFrame: pinned_frame];
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ResizeMode {
    Immediate,
    DeferToNextCaCommit,
    AfterNextPresentationUpdate,
}

static RESIZE_GEN: AtomicU64 = AtomicU64::new(0);
static CONFIRMED_GEN: AtomicU64 = AtomicU64::new(0);

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

const CA_TRANSACTION_PHASE_PRE_COMMIT: i32 = 1;

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

fn sentinel_chain_next_turn() {
    let block = block2::RcBlock::new(sentinel_tick);
    unsafe {
        dispatch_async(&_dispatch_main_q as *const std::ffi::c_void, &block);
    }
}

pub fn confirm_launcher_paint() {
    CONFIRMED_GEN.store(RESIZE_GEN.load(Ordering::Acquire), Ordering::Release);
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

pub fn cancel_pending_resize() {
    RESIZE_GEN.fetch_add(1, Ordering::AcqRel);
}

type OnceSlot = Rc<RefCell<Option<Box<dyn FnOnce()>>>>;

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

pub fn current_resize_generation() -> u64 {
    RESIZE_GEN.load(Ordering::Acquire)
}

/// # Safety
/// `ns_window` must be a valid, non-null pointer to an `NSWindow` instance.
pub unsafe fn force_apply_resize_if_generation_matches(
    ns_window: *mut AnyObject,
    height: f64,
    gen: u64,
) {
    if RESIZE_GEN.load(Ordering::Acquire) != gen {
        return;
    }
    let frame: NSRect = msg_send![ns_window, frame];
    if (frame.size.height - height).abs() > 0.5 {
        log::warn!("[launcher-resize] gen {gen} never presented; watchdog applying -> {height}");
        apply_window_height_commit(ns_window, height, gen);
        RESIZE_GEN.fetch_add(1, Ordering::AcqRel);
    }
}

unsafe fn apply_window_height_commit(ns_window: *mut AnyObject, height: f64, gen: u64) {
    let current = RESIZE_GEN.load(Ordering::Acquire);
    if current != gen {
        log::info!(
            "[launcher-resize] gen {gen} superseded by {current}; dropping resize to {height}"
        );
        return;
    }
    let frame: NSRect = msg_send![ns_window, frame];
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
    let _: () = msg_send![ns_window, setFrame: new_frame display: Bool::YES animate: Bool::NO];

    let content_view: *mut AnyObject = msg_send![ns_window, contentView];
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
}

/// Atomically resize the NSWindow (top edge pinned).
/// Returns `Some(gen)` if `AfterNextPresentationUpdate` was armed and requires a watchdog timer,
/// or `None` if the resize was committed or scheduled immediately.
///
/// # Safety
/// `ns_window` must be a valid, non-null pointer to an `NSWindow` instance.
pub unsafe fn set_launcher_window_height(
    ns_window: *mut AnyObject,
    height: f64,
    mode: ResizeMode,
) -> Option<u64> {
    let nsw = ns_window as usize;
    let gen = RESIZE_GEN.fetch_add(1, Ordering::AcqRel) + 1;

    let commit = move || unsafe {
        apply_window_height_commit(nsw as *mut AnyObject, height, gen);
    };

    match mode {
        ResizeMode::Immediate => {
            commit();
            None
        }
        ResizeMode::DeferToNextCaCommit => {
            schedule_on_next_pre_commit(commit);
            None
        }
        ResizeMode::AfterNextPresentationUpdate => {
            if get_window_alpha(ns_window) < 1.0 {
                commit();
                return None;
            }
            if CONFIRMED_GEN.load(Ordering::Acquire) >= gen {
                log::info!("[launcher-resize] gen {gen} confirmed before dispatch; committing via CA pre-commit");
                schedule_on_next_pre_commit(commit);
                return None;
            }
            let content_view: *mut AnyObject = msg_send![ns_window, contentView];
            let webview = find_webview(content_view);
            let hooked = if !webview.is_null() {
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
            };
            if !hooked {
                log::info!("[launcher-resize] webview absent; falling back to CA pre-commit");
                schedule_on_next_pre_commit(commit);
                None
            } else {
                Some(gen)
            }
        }
    }
}

pub fn activate_app() {
    unsafe {
        if let Some(ns_app_cls) = AnyClass::get("NSApplication") {
            let app: *mut AnyObject = msg_send![ns_app_cls, sharedApplication];
            if !app.is_null() {
                let _: () = msg_send![app, activateIgnoringOtherApps: true];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hud_panel_flags_include_fullscreen_auxiliary_and_can_join_all_spaces() {
        let flags = hud_panel_flags();
        const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
        const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;
        const NON_ACTIVATING_PANEL: i32 = 1 << 7;

        assert!(flags.collection_behavior_bits & FULL_SCREEN_AUXILIARY != 0);
        assert!(flags.collection_behavior_bits & CAN_JOIN_ALL_SPACES != 0);
        assert_eq!(flags.style_mask, NON_ACTIVATING_PANEL);
    }

    #[test]
    fn sticky_panel_flags_float_across_spaces_and_allow_typing() {
        let flags = sticky_panel_flags();
        const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
        const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;
        const RESIZABLE: i32 = 1 << 3;
        const NON_ACTIVATING_PANEL: i32 = 1 << 7;

        assert!(flags.collection_behavior_bits & CAN_JOIN_ALL_SPACES != 0);
        assert!(flags.collection_behavior_bits & FULL_SCREEN_AUXILIARY != 0);
        assert!(flags.style_mask & NON_ACTIVATING_PANEL != 0);
        assert!(flags.style_mask & RESIZABLE != 0);
    }

    #[test]
    fn sticky_panel_level_sits_below_the_launcher_and_hud() {
        const NS_NORMAL_WINDOW_LEVEL: i32 = 0;
        const NS_MAIN_MENU_WINDOW_LEVEL: i32 = 24;
        let launcher_level = NS_MAIN_MENU_WINDOW_LEVEL + 1;
        let hud_level = NS_MAIN_MENU_WINDOW_LEVEL + 2;

        let sticky_level = sticky_panel_flags().level;
        assert!(sticky_level > NS_NORMAL_WINDOW_LEVEL);
        assert!(sticky_level < launcher_level);
        assert!(sticky_level < hud_level);
    }

    #[test]
    fn spotlight_panel_collection_behavior_joins_all_spaces() {
        let bits = spotlight_collection_behavior_bits();
        const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
        const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;

        assert!(bits & CAN_JOIN_ALL_SPACES != 0);
        assert!(bits & FULL_SCREEN_AUXILIARY != 0);
    }

    #[test]
    fn heights_match_typescript_source() {
        const TS_SRC: &str = include_str!("../../../../../src/lib/launcher/launcherGeometry.ts");

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
        );
        assert_eq!(
            LAUNCHER_COMPACT_HEIGHT,
            extract(TS_SRC, "LAUNCHER_HEIGHT_COMPACT"),
        );
    }
}
