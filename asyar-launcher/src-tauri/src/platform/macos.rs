#![allow(deprecated)]
use std::cell::RefCell;
use std::path::Path;
use std::rc::Rc;
use tauri::{AppHandle, Manager, WebviewWindow, Runtime, Emitter};
use tauri_nspanel::{
    panel_delegate, Panel, WebviewWindowExt as PanelWebviewWindowExt,
};
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
use std::sync::atomic::Ordering;

// Use objc2 and its foundation for everything
use objc2::{msg_send, msg_send_id};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2_foundation::{NSString, NSRect, NSPoint, NSSize};

/// The resolved (OS-actual) appearance at window creation time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolvedTheme {
    Light,
    Dark,
}

/// HudWindow is the only material that stays uniformly translucent across
/// both modes — Sidebar in light made the launcher look nearly opaque while
/// dark stayed vibrant, breaking visual parity.
pub fn material_for_resolved_theme(_theme: ResolvedTheme) -> NSVisualEffectMaterial {
    NSVisualEffectMaterial::HudWindow
}

/// Resolves a `ThemePreference` to the actual appearance at call time.
/// For `System`, inspects `NSApp.effectiveAppearance` via the Objective-C
/// runtime; defaults to `Dark` on any inspection failure (preserves the
/// pre-existing HudWindow behavior on edge cases).
pub fn resolve_theme_preference(pref: crate::ThemePreference) -> ResolvedTheme {
    use crate::ThemePreference as TP;
    match pref {
        TP::Light => ResolvedTheme::Light,
        TP::Dark => ResolvedTheme::Dark,
        TP::System => detect_system_appearance(),
    }
}

fn detect_system_appearance() -> ResolvedTheme {
    unsafe {
        let app_cls = match AnyClass::get("NSApplication") {
            Some(c) => c,
            None => return ResolvedTheme::Dark,
        };
        let ns_app: *mut AnyObject = msg_send![app_cls, sharedApplication];
        if ns_app.is_null() { return ResolvedTheme::Dark; }

        let appearance: *mut AnyObject = msg_send![ns_app, effectiveAppearance];
        if appearance.is_null() { return ResolvedTheme::Dark; }

        // Ask the appearance to choose the best match from [DarkAqua, Aqua].
        let dark_name = NSString::from_str("NSAppearanceNameDarkAqua");
        let light_name = NSString::from_str("NSAppearanceNameAqua");

        // +[NSArray arrayWithObjects:count:] — simplest way without importing NSArray.
        let arr_cls = match AnyClass::get("NSArray") {
            Some(c) => c,
            None => return ResolvedTheme::Dark,
        };
        let names: [*const AnyObject; 2] = [
            Retained::as_ptr(&dark_name) as *const AnyObject,
            Retained::as_ptr(&light_name) as *const AnyObject,
        ];
        let name_array: *mut AnyObject = msg_send![
            arr_cls,
            arrayWithObjects: names.as_ptr()
            count: 2usize
        ];

        let best: *mut AnyObject = msg_send![appearance, bestMatchFromAppearancesWithNames: name_array];
        if best.is_null() { return ResolvedTheme::Dark; }

        let best_name: Option<Retained<NSString>> = msg_send_id![best, description];
        match best_name.map(|s| s.to_string()) {
            Some(ref s) if s.contains("Dark") => ResolvedTheme::Dark,
            Some(_) => ResolvedTheme::Light,
            None => ResolvedTheme::Dark,
        }
    }
}

/// Configures a window to behave as a macOS Spotlight-style search bar.
pub fn setup_spotlight_window<R: Runtime>(window: &WebviewWindow<R>, app: &AppHandle<R>, theme_pref: crate::ThemePreference) -> tauri::Result<Panel> {
    let panel = window.to_panel().map_err(|_| tauri::Error::FailedToReceiveMessage)?;
    
    // Panel levels and behaviors can be set via the Panel wrapper which handles the raw conversion
    panel.set_level(tauri_nspanel::cocoa::appkit::NSMainMenuWindowLevel + 1);
    panel.set_collection_behaviour(tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary);

    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);

    let panel_delegate = panel_delegate!(SpotlightPanelDelegate {
        window_did_resign_key,
        window_did_become_key
    });

    let app_handle = app.clone();
    let label = window.label().to_string();
    panel_delegate.set_listener(Box::new(move |delegate_name: String| {
        match delegate_name.as_str() {
            "window_did_become_key" => { let _ = app_handle.emit(&format!("{}_panel_did_become_key", label), ()); }
            "window_did_resign_key" => { let _ = app_handle.emit(&format!("{}_panel_did_resign_key", label), ()); }
            _ => (),
        }
    }));
    panel.set_delegate(panel_delegate);

    let material = material_for_resolved_theme(resolve_theme_preference(theme_pref));
    apply_vibrancy(window, material, None, Some(15.0))
        .expect("Failed to apply vibrancy");

    // Seed the NSWindow appearance so the first composited frame already has
    // the correct blur tint — without this, a mismatch between Asyar's stored
    // theme and the OS appearance produces a washed-out panel on the very
    // first show. apply_panel_appearance is idempotent and no-ops on the
    // material if it was just set by apply_vibrancy above.
    apply_panel_appearance(window, theme_pref);

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
    unsafe { let _: () = msg_send![ns_window, setAlphaValue: alpha]; }
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
unsafe fn find_webview(cv: *mut AnyObject) -> *mut AnyObject { find_subview(cv, false) }
unsafe fn find_vibrancy_view(cv: *mut AnyObject) -> *mut AnyObject { find_subview(cv, true) }

/// Pin the WKWebView and vibrancy view at LAUNCHER_MAX_HEIGHT with height
/// auto-resizing off, so NSWindow resize only crops — AppKit's frame change
/// and WebKit's paint run on independent pipelines, so letting the webview
/// re-lay out produces a 1-frame interstitial.
pub fn pin_launcher_webview<R: Runtime>(window: &WebviewWindow<R>) {
    let nsw = window.ns_window().unwrap() as *mut AnyObject;
    unsafe {
        let content_view: *mut AnyObject = msg_send![nsw, contentView];
        let content_frame: NSRect = msg_send![content_view, frame];

        // Clip contentView to a 15px rounded rect so all subviews share the
        // same mask — window_vibrancy only rounds the vibrancy view, and once
        // the webview is pinned on top its square corners cover vibrancy's.
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content_view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: 15.0_f64];
            let _: () = msg_send![layer, setMasksToBounds: Bool::YES];
        }

        // NSViewWidthSizable = 2 (width stretches, height frozen).
        let pinned_frame = NSRect {
            origin: NSPoint { x: 0.0, y: 0.0 },
            size: NSSize { width: content_frame.size.width, height: LAUNCHER_MAX_HEIGHT },
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
}

/// Atomically resize the NSWindow (top edge pinned), reposition the pinned
/// webview + vibrancy layer, and toggle the native Show More bar — one
/// main-thread turn, one CATransaction. `expanded: None` leaves bar visibility
/// alone; `Some(true)` hides it, `Some(false)` shows it.
///
/// `DeferToNextCaCommit` attaches the resize to the current CA transaction's
/// pre-commit phase so it lands in the same render-server commit as WebKit's
/// pending paint. Used for extension-transition resizes (goBack shrink,
/// hotkey-entry grow) where the SearchHeader chrome is swapping one frame
/// away from the window resize.
pub fn set_launcher_window_height<R: Runtime>(
    window: &WebviewWindow<R>,
    height: f64,
    expanded: Option<bool>,
    mode: ResizeMode,
) {
    // Cast through `usize` so the closure stays `Send` (raw pointers aren't);
    // the block only ever fires on the main thread.
    let nsw = window.ns_window().unwrap() as *mut AnyObject as usize;

    let commit = move || unsafe {
        let nsw = nsw as *mut AnyObject;
        let frame: NSRect = msg_send![nsw, frame];
        let new_y = frame.origin.y + frame.size.height - height;
        let new_frame = NSRect {
            origin: NSPoint { x: frame.origin.x, y: new_y },
            size: NSSize { width: frame.size.width, height },
        };
        // animate: NO — AppKit's default ~200ms resize animation would paint
        // interstitial frames instead of committing atomically below.
        let _: () = msg_send![nsw, setFrame: new_frame display: Bool::YES animate: Bool::NO];

        // origin.y is negative when compact (pinned view extends below the
        // cropped window), zero when expanded.
        let content_view: *mut AnyObject = msg_send![nsw, contentView];
        let new_origin_y = height - LAUNCHER_MAX_HEIGHT;

        for view in [find_webview(content_view), find_vibrancy_view(content_view)] {
            if view.is_null() { continue; }
            let f: NSRect = msg_send![view, frame];
            let new_f = NSRect { origin: NSPoint { x: 0.0, y: new_origin_y }, size: f.size };
            let _: () = msg_send![view, setFrame: new_f];
        }

        show_more_bar::reposition_and_toggle(height, expanded);
    };

    match mode {
        ResizeMode::Immediate => commit(),
        ResizeMode::DeferToNextCaCommit => schedule_on_next_pre_commit(commit),
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
        if let Some(f) = for_block.borrow_mut().take() { f(); }
    });

    unsafe {
        let ca = AnyClass::get("CATransaction").expect("CATransaction class");
        let ok: Bool = msg_send![
            ca,
            addCommitHandler: &*block
            forPhase: CA_TRANSACTION_PHASE_PRE_COMMIT
        ];
        if !ok.as_bool() {
            if let Some(f) = slot.borrow_mut().take() { f(); }
        }
    }
}

pub fn center_at_cursor_monitor<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let monitor = monitor::get_monitor_with_cursor().ok_or_else(|| tauri::Error::FailedToReceiveMessage)?;
    let monitor_scale_factor = monitor.scale_factor();
    let monitor_size = monitor.size().to_logical::<f64>(monitor_scale_factor);
    let monitor_position = monitor.position().to_logical::<f64>(monitor_scale_factor);
    let window_frame = get_window_frame(window);
    let top_y = monitor_position.y + monitor_size.height - (monitor_size.height * 0.16);
    let rect = NSRect {
        origin: NSPoint {
            x: (monitor_position.x + (monitor_size.width / 2.0)) - (window_frame.size.width / 2.0),
            y: top_y - window_frame.size.height,
        },
        size: window_frame.size,
    };
    set_window_frame(window, rect);
    Ok(())
}

fn get_app_icon_name(path: &Path) -> String {
    let plist_path = path.join("Contents/Info.plist");
    plist::from_file::<_, plist::Value>(&plist_path)
        .ok().and_then(|v| v.into_dictionary()).and_then(|d| d.get("CFBundleIconFile").cloned())
        .and_then(|v| v.into_string()).unwrap_or_else(|| "AppIcon".to_string())
}

pub fn extract_icon(path: &Path) -> Option<Vec<u8>> {
    let icon_name = get_app_icon_name(path);
    let icon_filename = if icon_name.ends_with(".icns") { icon_name } else { format!("{}.icns", icon_name) };
    let icns_path = path.join("Contents/Resources").join(&icon_filename);
    let icns_path = if icns_path.exists() { icns_path } else {
        let resources_dir = path.join("Contents/Resources");
        std::fs::read_dir(&resources_dir).ok()?.filter_map(|e| e.ok())
            .find(|e| e.path().extension().map(|x| x == "icns").unwrap_or(false))?.path()
    };
    let file = std::fs::File::open(&icns_path).ok()?;
    let icon_family = icns::IconFamily::read(file).ok()?;
    let preferred = [
        icns::IconType::RGB24_32x32,
        icns::IconType::RGBA32_32x32,
        icns::IconType::RGBA32_64x64,
        icns::IconType::RGBA32_128x128,
        icns::IconType::RGB24_16x16,
    ];
    for icon_type in &preferred {
        if let Ok(image) = icon_family.get_icon_with_type(*icon_type) {
            let mut buf = std::io::Cursor::new(Vec::new());
            if image.write_png(&mut buf).is_ok() {
                return Some(buf.into_inner());
            }
        }
    }
    // Fallback: try any available icon type
    for icon_type in icon_family.available_icons() {
        if let Ok(image) = icon_family.get_icon_with_type(icon_type) {
            let mut buf = std::io::Cursor::new(Vec::new());
            if image.write_png(&mut buf).is_ok() {
                return Some(buf.into_inner());
            }
        }
    }
    None
}

/// Sets the NSWindow's NSAppearance and the NSVisualEffectView material to
/// match `pref`. Both operations are needed: the material's tint is
/// determined by `effectiveAppearance`, so without the appearance override
/// even `HudWindow` material renders light-tinted when the OS is in light
/// mode, producing the washed-out panel the user sees when Asyar=Dark but
/// OS=Light.
///
/// NSAppearance mapping:
/// - `Light`  → `NSAppearanceNameAqua`   (explicit light appearance)
/// - `Dark`   → `NSAppearanceNameDarkAqua` (explicit dark appearance)
/// - `System` → `nil` (AppKit auto-tracks the OS; idiomatic pattern)
///
/// The material switch is idempotent — reads the current value and skips
/// `setMaterial:` if unchanged. The appearance override is always applied
/// because nil vs non-nil can't be compared cheaply via objc2.
///
/// Must be called on the main thread. Returns silently if the window or
/// vibrancy view cannot be located.
pub fn apply_panel_appearance<R: Runtime>(window: &WebviewWindow<R>, pref: crate::ThemePreference) {
    let ns_window = match window.ns_window() {
        Ok(ptr) => ptr as *mut AnyObject,
        Err(_) => {
            log::warn!("[apply_panel_appearance] ns_window() failed");
            return;
        }
    };

    unsafe {
        // Set the window's NSAppearance so the blur material tints correctly
        // regardless of the OS appearance. nil means "follow the OS".
        let appearance: *mut AnyObject = match pref {
            crate::ThemePreference::Light => {
                let cls = match AnyClass::get("NSAppearance") {
                    Some(c) => c,
                    None => {
                        log::warn!("[apply_panel_appearance] NSAppearance class not found");
                        return;
                    }
                };
                let name = NSString::from_str("NSAppearanceNameAqua");
                msg_send![cls, appearanceNamed: Retained::as_ptr(&name)]
            }
            crate::ThemePreference::Dark => {
                let cls = match AnyClass::get("NSAppearance") {
                    Some(c) => c,
                    None => {
                        log::warn!("[apply_panel_appearance] NSAppearance class not found");
                        return;
                    }
                };
                let name = NSString::from_str("NSAppearanceNameDarkAqua");
                msg_send![cls, appearanceNamed: Retained::as_ptr(&name)]
            }
            crate::ThemePreference::System => std::ptr::null_mut(),
        };
        let _: () = msg_send![ns_window, setAppearance: appearance];

        // Update the vibrancy material to match the resolved appearance.
        let resolved = resolve_theme_preference(pref);
        let target_material = material_for_resolved_theme(resolved);
        let target_raw = target_material as i64;

        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        let vibrancy = find_vibrancy_view(content_view);
        if vibrancy.is_null() {
            log::warn!("[apply_panel_appearance] vibrancy view not found");
            return;
        }

        let current_raw: i64 = msg_send![vibrancy, material];
        if current_raw != target_raw {
            let _: () = msg_send![vibrancy, setMaterial: target_raw];
        }
    }
}

/// Registers a `NSDistributedNotificationCenter` observer for
/// `AppleInterfaceThemeChangedNotification`. When the OS appearance changes,
/// the block re-reads the managed `Mutex<ThemePreference>`. If the preference
/// is `System`, it re-applies both the NSWindow appearance and the vibrancy
/// material — if the user chose Light or Dark explicitly, the OS toggle is
/// ignored (user's explicit choice wins; the appearance was already pinned via
/// setAppearance: at preference-set time).
///
/// Delivers on the main queue so AppKit calls are safe without a further
/// thread hop.
///
/// The observer is leaked intentionally: it must live for the entire app
/// lifetime, and `NSDistributedNotificationCenter` retains it internally.
pub fn install_appearance_observer<R: Runtime + 'static>(app: &AppHandle<R>) {
    use objc2::rc::Retained;
    use objc2_foundation::{NSNotification, NSString};

    let app_handle = app.clone();

    let block = block2::RcBlock::new(move |_note: std::ptr::NonNull<NSNotification>| {
        let pref = {
            let state = app_handle.try_state::<std::sync::Mutex<crate::ThemePreference>>();
            match state {
                Some(s) => *s.lock().unwrap_or_else(|p| p.into_inner()),
                None => crate::ThemePreference::System,
            }
        };

        // Only act on OS flips when the user chose System. For Light/Dark,
        // setAppearance: already pinned the window appearance — skipping
        // here avoids a redundant AppKit call and keeps intent clear.
        if pref == crate::ThemePreference::System {
            if let Some(window) = app_handle.get_webview_window(crate::SPOTLIGHT_LABEL) {
                apply_panel_appearance(&window, pref);
            }
        }
    });

    unsafe {
        let center_cls = match AnyClass::get("NSDistributedNotificationCenter") {
            Some(c) => c,
            None => {
                log::error!("[install_appearance_observer] NSDistributedNotificationCenter class not found");
                return;
            }
        };
        let center: *mut AnyObject = msg_send![center_cls, defaultCenter];
        if center.is_null() {
            log::error!("[install_appearance_observer] defaultCenter returned null");
            return;
        }

        let notif_name = NSString::from_str("AppleInterfaceThemeChangedNotification");
        let main_queue_cls = match AnyClass::get("NSOperationQueue") {
            Some(c) => c,
            None => {
                log::error!("[install_appearance_observer] NSOperationQueue class not found");
                return;
            }
        };
        let main_queue: *mut AnyObject = msg_send![main_queue_cls, mainQueue];

        let nil: *const AnyObject = std::ptr::null();
        let observer: Option<Retained<AnyObject>> = msg_send_id![
            center,
            addObserverForName: Retained::as_ptr(&notif_name)
            object: nil
            queue: main_queue
            usingBlock: &*block as &block2::Block<dyn Fn(std::ptr::NonNull<NSNotification>)>
        ];

        match observer {
            Some(obs) => {
                // Intentional leak: observer must live for the app lifetime.
                std::mem::forget(obs);
            }
            None => {
                log::error!("[install_appearance_observer] addObserverForName returned nil");
            }
        }
    }
}

pub fn register_cmdq_monitor(app_handle: AppHandle) {
    use block2::StackBlock;
    const KEY_DOWN_MASK: u64 = 1u64 << 10;
    const VK_Q: u16 = 12;
    const CMD_FLAG: u64 = 1 << 20;
    let app = app_handle.clone();
    let handler = StackBlock::new(move |event: *mut AnyObject| -> *mut AnyObject {
        let keycode: u16 = unsafe { msg_send![event, keyCode] };
        let flags: u64 = unsafe { msg_send![event, modifierFlags] };
        if keycode == VK_Q && (flags & CMD_FLAG) != 0 {
            if let Some(sw) = app.get_webview_window("settings") {
                if sw.is_visible().unwrap_or(false) && sw.is_focused().unwrap_or(false) {
                    let _ = sw.hide(); return std::ptr::null_mut();
                }
            }
        }
        event
    });
    let ns_event_cls = AnyClass::get("NSEvent").expect("NSEvent class not found");
    let monitor: Option<Retained<AnyObject>> = unsafe {
        msg_send_id![ns_event_cls, addLocalMonitorForEventsMatchingMask: KEY_DOWN_MASK, handler: &handler]
    };
    if let Some(m) = monitor {
        Box::leak(Box::new(m));
    } else {
        log::error!("CMD+Q local event monitor registration failed");
    }
}

pub fn register_snippet_monitor(app_handle: AppHandle) {
    use block2::StackBlock;
    use std::sync::{Arc, Mutex};

    const KEY_DOWN_MASK: u64 = 1u64 << 10;

    let buffer: Arc<Mutex<Vec<char>>> = Arc::new(Mutex::new(Vec::new()));
    let buf = Arc::clone(&buffer);
    let app = app_handle.clone();

    let handler = StackBlock::new(move |event: *mut AnyObject| {
        let state = app.state::<crate::AppState>();

        if state.asyar_visible.load(Ordering::Relaxed)
            || !state.snippets_enabled.load(Ordering::Relaxed)
            || state.is_expanding.load(Ordering::SeqCst)
        {
            buf.lock().unwrap_or_else(|p| p.into_inner()).clear();
            return;
        }

        let keycode: u16 = unsafe { msg_send![event, keyCode] };
        match keycode {
            53 => { // Escape
                buf.lock().unwrap_or_else(|p| p.into_inner()).clear();
                return;
            }
            36 | 52 => { // Return / numpad Enter
                buf.lock().unwrap_or_else(|p| p.into_inner()).clear();
                return;
            }
            48 => { // Tab
                buf.lock().unwrap_or_else(|p| p.into_inner()).clear();
                return;
            }
            51 | 117 => { // Delete / Forward Delete
                buf.lock().unwrap_or_else(|p| p.into_inner()).pop();
                return;
            }
            123..=126 => { // Arrow keys
                buf.lock().unwrap_or_else(|p| p.into_inner()).clear();
                return;
            }
            _ => {}
        }

        let chars_obj: Option<Retained<AnyObject>> =
            unsafe { msg_send_id![event, charactersIgnoringModifiers] };

        if let Some(chars) = chars_obj {
            let utf8: *const i8 = unsafe { msg_send![&*chars, UTF8String] };
            if utf8.is_null() {
                return;
            }
            let s = unsafe {
                std::ffi::CStr::from_ptr(utf8)
                    .to_str()
                    .unwrap_or("")
                    .to_string()
            };

            let mut buffer = buf.lock().unwrap_or_else(|p| p.into_inner());
            for c in s.chars() {
                if c.is_control() {
                    continue;
                }
                for lc in c.to_lowercase() {
                    buffer.push(lc);
                }
                if buffer.len() > 64 {
                    buffer.remove(0);
                }
            }

            let current: String = buffer.iter().collect();
            let snippets = state
                .active_snippets
                .lock()
                .unwrap_or_else(|p| p.into_inner());

            for (keyword, expansion) in snippets.iter() {
                if current.ends_with(keyword.as_str()) {
                    let kw_len = keyword.chars().count();
                    let exp = expansion.clone();
                    buffer.clear();
                    drop(snippets);
                    let _ = app.emit_to(
                        crate::SPOTLIGHT_LABEL,
                        "expand-snippet",
                        serde_json::json!({
                            "keywordLen": kw_len,
                            "expansion": exp
                        }),
                    );
                    return;
                }
            }
        }
    });

    let ns_event_cls = AnyClass::get("NSEvent").expect("NSEvent class not found");
    let monitor: Option<Retained<AnyObject>> = unsafe {
        msg_send_id![
            ns_event_cls,
            addGlobalMonitorForEventsMatchingMask: KEY_DOWN_MASK,
            handler: &handler
        ]
    };

    if let Some(m) = monitor {
        Box::leak(Box::new(m));
    } else {
        log::error!("[snippets] NSEvent monitor registration failed");
    }
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" { fn AXIsProcessTrusted() -> bool; }
pub fn is_accessibility_trusted() -> bool { unsafe { AXIsProcessTrusted() } }
pub fn open_accessibility_prefs() {
    let _ = std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility").spawn();
}

pub fn get_frontmost_app_pid() -> Option<i32> {
    unsafe {
        let workspace_class = AnyClass::get("NSWorkspace")?;
        let workspace: *mut AnyObject = msg_send![workspace_class, sharedWorkspace];
        if workspace.is_null() {
            log::warn!("[paste] get_frontmost_app_pid: sharedWorkspace returned null");
            return None;
        }
        let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            log::warn!("[paste] get_frontmost_app_pid: frontmostApplication returned null");
            return None;
        }
        let pid: i32 = msg_send![app, processIdentifier];
        log::info!("[paste] get_frontmost_app_pid: raw_pid={}", pid);
        if pid > 0 {
            Some(pid)
        } else {
            log::warn!("[paste] get_frontmost_app_pid: invalid pid={}", pid);
            None
        }
    }
}

pub fn get_frontmost_application_metadata() -> Option<(String, String, String, String)> {
    unsafe {
        let workspace_class = AnyClass::get("NSWorkspace")?;
        let workspace: *mut AnyObject = msg_send![workspace_class, sharedWorkspace];
        if workspace.is_null() { return None; }
        let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if app.is_null() { return None; }

        let bid_obj: Option<Retained<NSString>> = msg_send_id![app, bundleIdentifier];
        let bid = bid_obj.map(|s: Retained<NSString>| s.to_string()).unwrap_or_default();

        let url: *mut AnyObject = msg_send![app, bundleURL];
        let path = if !url.is_null() {
            let path_obj: Option<Retained<NSString>> = msg_send_id![url, path];
            path_obj.map(|s: Retained<NSString>| s.to_string()).unwrap_or_default()
        } else { String::new() };

        let name_obj: Option<Retained<NSString>> = msg_send_id![app, localizedName];
        let name = name_obj.map(|s: Retained<NSString>| s.to_string()).unwrap_or_else(|| {
            Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("Unknown").to_string()
        });

        let title = get_focused_window_title().unwrap_or_default();
        Some((name, bid, path, title))
    }
}

fn get_focused_window_title() -> Option<String> {
    use std::ffi::{c_void, CStr};
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementCopyAttributeValue(element: *mut c_void, attribute: *mut c_void, value: *mut *mut c_void) -> i32;
        fn CFRelease(cf: *mut c_void);
        fn CFStringGetCStringPtr(s: *mut c_void, encoding: u32) -> *const i8;
        fn CFStringGetLength(s: *mut c_void) -> isize;
        fn CFStringGetCString(s: *mut c_void, buf: *mut i8, buf_size: isize, encoding: u32) -> bool;
    }
    const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;
    unsafe {
        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() { return None; }
        let focused_attr_ns = NSString::from_str("AXFocusedUIElement");
        let mut focused: *mut c_void = std::ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(system_wide, Retained::as_ptr(&focused_attr_ns) as *mut _, &mut focused);
        CFRelease(system_wide);
        if err != 0 || focused.is_null() { return None; }
        let title_attr_ns = NSString::from_str("AXTitle");
        let mut title_val: *mut c_void = std::ptr::null_mut();
        let err2 = AXUIElementCopyAttributeValue(focused, Retained::as_ptr(&title_attr_ns) as *mut _, &mut title_val);
        CFRelease(focused);
        if err2 != 0 || title_val.is_null() { return None; }
        let result = if !title_val.is_null() {
            let ptr = CFStringGetCStringPtr(title_val, K_CF_STRING_ENCODING_UTF8);
            if !ptr.is_null() { Some(CStr::from_ptr(ptr).to_string_lossy().into_owned()) }
            else {
                let len = CFStringGetLength(title_val);
                if len > 0 {
                    let mut buf = vec![0u8; (len * 4 + 1) as usize];
                    if CFStringGetCString(title_val, buf.as_mut_ptr() as *mut i8, buf.len() as isize, K_CF_STRING_ENCODING_UTF8) {
                        Some(CStr::from_ptr(buf.as_ptr() as *const i8).to_string_lossy().into_owned())
                    } else { None }
                } else { Some(String::new()) }
            }
        } else { None };
        CFRelease(title_val);
        result
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Native Show More bar — an NSView, not a DOM element, so its setHidden:
// commits in the same CATransaction as NSWindow setFrame:. A Svelte overlay
// paints on WebKit's pipeline and lands one display frame off, producing a
// visible interstitial. `reposition_and_toggle` is called from inside the same
// unsafe block as setFrame: so both mutations commit together.
//
// KEEP IN SYNC: the Windows/Linux counterpart is a Svelte overlay in
// asyar-launcher/src/components/layout/BottomActionBar.svelte (the `!IS_MACOS`
// branch). Any visual change here (label text, keyboard hint, colors,
// typography, spacing, extra buttons) MUST be mirrored there, and vice versa.
// No automatic sync exists — nativeBarSync.ts pushes CSS-variable colors, but
// layout and structure are hardcoded on each side.
// ────────────────────────────────────────────────────────────────────────────

mod show_more_bar {
    use std::ffi::CString;
    use std::sync::Mutex;
    use objc2::declare::ClassBuilder;
    use objc2::encode::{Encoding, RefEncode};
    use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
    use objc2::{msg_send, sel};
    use objc2_foundation::{NSRect, NSPoint, NSSize};

    const SEARCH_HEADER_HEIGHT: f64 = 56.0;
    const SHOW_MORE_BAR_HEIGHT: f64 = 40.0;

    /// References to all the styled subviews. Stored so theme pushes can
    /// update each color independently. All `usize` so the struct is `Send`;
    /// access happens only on the main thread.
    #[derive(Default, Clone, Copy)]
    struct BarViews {
        bar: usize,
        chip: usize,
        label: usize,
        glyph: usize,
    }
    static BAR_VIEWS: Mutex<Option<BarViews>> = Mutex::new(None);

    /// Boxed click callback pointer — leaked on install, lives for the app's
    /// lifetime. The ObjC mouseDown: method reads this to invoke the callback.
    static CLICK_CALLBACK_PTR: Mutex<Option<usize>> = Mutex::new(None);

    /// Creates and installs the native Show More bar. Called once, after the
    /// webview has been pinned. `on_click` fires on each bar click.
    pub(super) fn create<F: Fn() + Send + Sync + 'static>(
        content_view: *mut AnyObject,
        content_width: f64,
        on_click: F,
    ) {
        unsafe {
            let boxed: Box<Box<dyn Fn() + Send + Sync>> = Box::new(Box::new(on_click));
            let ptr = Box::into_raw(boxed) as usize;
            *CLICK_CALLBACK_PTR.lock().unwrap() = Some(ptr);

            let bar_class = register_class();

            // Bar initial frame (compact: window height = 96, bar at y=0).
            let bar_frame = NSRect {
                origin: NSPoint { x: 0.0, y: 0.0 },
                size: NSSize { width: content_width, height: SHOW_MORE_BAR_HEIGHT },
            };
            let bar: *mut AnyObject = msg_send![bar_class, alloc];
            let bar: *mut AnyObject = msg_send![bar, initWithFrame: bar_frame];

            let _: () = msg_send![bar, setWantsLayer: true];
            // Width-sizable only (NSViewWidthSizable = 2). We manage origin.y.
            let _: () = msg_send![bar, setAutoresizingMask: 2u64];

            // Background seeded to --bg-secondary-full-opacity dark default;
            // JS pushes theme-accurate colors via apply_show_more_bar_style.
            set_layer_bg(bar, 40.0 / 255.0, 40.0 / 255.0, 42.0 / 255.0, 1.0);

            // Key-hint chip — 24×21 rounded rect, pinned right, vertically centered.
            // Matches KeyboardHint.svelte's kbd dimensions so the native bar's
            // chip looks identical to in-webview kbd elements.
            let chip_width = 24.0;
            let chip_height = 21.0;
            let chip_right_margin = 12.0;
            let chip_y = (SHOW_MORE_BAR_HEIGHT - chip_height) / 2.0;
            let chip_x = content_width - chip_right_margin - chip_width;
            let chip = make_plain_view(NSRect {
                origin: NSPoint { x: chip_x, y: chip_y },
                size: NSSize { width: chip_width, height: chip_height },
            });
            // NSViewMinXMargin = 1 (left margin flexible → pins right).
            let _: () = msg_send![chip, setAutoresizingMask: 1u64];
            let chip_layer: *mut AnyObject = msg_send![chip, layer];
            // Radius matches --radius-sm in KeyboardHint.svelte. Border color
            // is pushed from JS (set_layer_border) so the rim follows the theme.
            let _: () = msg_send![chip_layer, setCornerRadius: 6.0_f64];
            let _: () = msg_send![chip_layer, setBorderWidth: 1.0_f64];
            set_layer_bg(chip, 1.0, 1.0, 1.0, 0.08);

            // "↓" glyph — NSImageView + SF Symbol. NSTextField adds asymmetric
            // cell padding that throws off single-char centering; NSImageView
            // renders at intrinsic size, geometrically centered in bounds.
            let glyph = make_symbol_image_view(
                "arrow.down",
                NSRect {
                    origin: NSPoint { x: 0.0, y: 0.0 },
                    size: NSSize { width: chip_width, height: chip_height },
                },
                9.0,
                SymbolWeight::Medium,
                235.0 / 255.0, 235.0 / 255.0, 245.0 / 255.0, 0.65,
            );
            let _: () = msg_send![chip, addSubview: glyph];
            let _: () = msg_send![bar, addSubview: chip];

            // "Show More" label. Left-aligned + sizeToFit so the frame hugs
            // the glyphs; right-align would add NSTextField's ~6px cell-inset
            // and break the chip-to-text gap math.
            const TEXT_TO_CHIP_GAP: f64 = 11.0;
            let label = make_label(
                "Show More",
                NSRect {
                    origin: NSPoint { x: 0.0, y: 0.0 },
                    size: NSSize { width: 200.0, height: 18.0 },
                },
                13.0,
                235.0 / 255.0, 235.0 / 255.0, 245.0 / 255.0, 0.65,
                TextAlign::Left,
            );
            let _: () = msg_send![label, sizeToFit];
            let label_frame: NSRect = msg_send![label, frame];
            let label_x = content_width - chip_right_margin - chip_width - TEXT_TO_CHIP_GAP - label_frame.size.width;
            let label_y = (SHOW_MORE_BAR_HEIGHT - label_frame.size.height) / 2.0;
            let positioned_frame = NSRect {
                origin: NSPoint { x: label_x, y: label_y },
                size: label_frame.size,
            };
            let _: () = msg_send![label, setFrame: positioned_frame];
            // Pin right (same as chip) so they move together if the bar resizes.
            let _: () = msg_send![label, setAutoresizingMask: 1u64];
            let _: () = msg_send![bar, addSubview: label];

            // Top subview of contentView (above webview + vibrancy).
            let _: () = msg_send![content_view, addSubview: bar];

            // Start hidden — NSView composites instantly, but WKWebView needs
            // a layout/paint cycle for its first frame; revealing now would
            // show the bar over a blank webview. Frontend's onMount rAF calls
            // reveal_show_more_bar to flip it with WebKit's first frame.
            let _: () = msg_send![bar, setHidden: Bool::YES];

            *BAR_VIEWS.lock().unwrap() = Some(BarViews {
                bar: bar as usize,
                chip: chip as usize,
                label: label as usize,
                glyph: glyph as usize,
            });
        }
    }

    /// Reposition + visibility toggle. Called from inside the same unsafe
    /// block as setFrame: so both mutations commit to the same CATransaction.
    pub(super) unsafe fn reposition_and_toggle(height: f64, expanded: Option<bool>) {
        let Some(views) = *BAR_VIEWS.lock().unwrap() else { return };
        let bar: *mut AnyObject = views.bar as *mut AnyObject;

        let new_y = height - SEARCH_HEADER_HEIGHT - SHOW_MORE_BAR_HEIGHT;
        let current: NSRect = msg_send![bar, frame];
        let new_frame = NSRect {
            origin: NSPoint { x: 0.0, y: new_y },
            size: current.size,
        };
        let _: () = msg_send![bar, setFrame: new_frame];

        if let Some(is_expanded) = expanded {
            let _: () = msg_send![bar, setHidden: Bool::new(is_expanded)];
        }
    }

    /// Bar visibility only, no reposition. Used for the first-paint reveal —
    /// see note in `create`.
    pub(super) unsafe fn set_hidden(hidden: bool) {
        let Some(views) = *BAR_VIEWS.lock().unwrap() else { return };
        let bar: *mut AnyObject = views.bar as *mut AnyObject;
        let _: () = msg_send![bar, setHidden: Bool::new(hidden)];
    }

    #[derive(Copy, Clone)]
    pub(super) struct BarStyle {
        pub bar_bg: (f64, f64, f64, f64),
        pub text: (f64, f64, f64, f64),
        pub chip_bg: (f64, f64, f64, f64),
        pub chip_border: (f64, f64, f64, f64),
    }

    /// Applies a new color palette to the already-built bar. Returns silently
    /// if the bar hasn't been built yet (early startup before create()).
    pub(super) fn apply_style(style: BarStyle) {
        let Some(views) = *BAR_VIEWS.lock().unwrap() else { return };
        unsafe {
            let bar: *mut AnyObject = views.bar as *mut AnyObject;
            let chip: *mut AnyObject = views.chip as *mut AnyObject;
            let label: *mut AnyObject = views.label as *mut AnyObject;
            let glyph: *mut AnyObject = views.glyph as *mut AnyObject;

            set_layer_bg(bar, style.bar_bg.0, style.bar_bg.1, style.bar_bg.2, style.bar_bg.3);
            set_layer_bg(chip, style.chip_bg.0, style.chip_bg.1, style.chip_bg.2, style.chip_bg.3);
            set_layer_border(chip, style.chip_border.0, style.chip_border.1, style.chip_border.2, style.chip_border.3);

            set_text_color(label, style.text.0, style.text.1, style.text.2, style.text.3);
            set_image_tint(glyph, style.text.0, style.text.1, style.text.2, style.text.3);
        }
    }

    unsafe fn set_text_color(textfield: *mut AnyObject, r: f64, g: f64, b: f64, a: f64) {
        let nscolor_cls = AnyClass::get("NSColor").expect("NSColor");
        let color: *mut AnyObject = msg_send![nscolor_cls,
            colorWithSRGBRed: r green: g blue: b alpha: a];
        let _: () = msg_send![textfield, setTextColor: color];
    }

    unsafe fn set_image_tint(image_view: *mut AnyObject, r: f64, g: f64, b: f64, a: f64) {
        let nscolor_cls = AnyClass::get("NSColor").expect("NSColor");
        let color: *mut AnyObject = msg_send![nscolor_cls,
            colorWithSRGBRed: r green: g blue: b alpha: a];
        let _: () = msg_send![image_view, setContentTintColor: color];
    }

    // ── ObjC subclass ──────────────────────────────────────────────────────

    fn register_class() -> &'static AnyClass {
        if let Some(cls) = AnyClass::get("AsyarShowMoreBar") {
            return cls;
        }

        let superclass = AnyClass::get("NSView").expect("NSView");
        let mut builder = ClassBuilder::new("AsyarShowMoreBar", superclass)
            .expect("ClassBuilder::new for AsyarShowMoreBar returned None");

        extern "C" fn mouse_down(_this: *mut AnyObject, _sel: Sel, _event: *mut AnyObject) {
            if let Some(ptr) = *CLICK_CALLBACK_PTR.lock().unwrap() {
                unsafe {
                    let cb: *const Box<dyn Fn() + Send + Sync> = ptr as *const _;
                    (*cb)();
                }
            }
        }

        extern "C" fn accepts_first_mouse(
            _this: *mut AnyObject,
            _sel: Sel,
            _event: *mut AnyObject,
        ) -> Bool {
            Bool::YES
        }

        unsafe {
            builder.add_method(sel!(mouseDown:), mouse_down as extern "C" fn(_, _, _));
            builder.add_method(
                sel!(acceptsFirstMouse:),
                accepts_first_mouse as extern "C" fn(_, _, _) -> Bool,
            );
        }

        builder.register()
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    #[allow(dead_code)]
    enum TextAlign { Left, Center, Right }

    unsafe fn make_plain_view(frame: NSRect) -> *mut AnyObject {
        let cls = AnyClass::get("NSView").expect("NSView");
        let v: *mut AnyObject = msg_send![cls, alloc];
        let v: *mut AnyObject = msg_send![v, initWithFrame: frame];
        let _: () = msg_send![v, setWantsLayer: true];
        v
    }

    #[allow(clippy::too_many_arguments)]
    unsafe fn make_label(
        text: &str,
        frame: NSRect,
        font_size: f64,
        r: f64, g: f64, b: f64, a: f64,
        align: TextAlign,
    ) -> *mut AnyObject {
        let tf_cls = AnyClass::get("NSTextField").expect("NSTextField");
        let tf: *mut AnyObject = msg_send![tf_cls, alloc];
        let tf: *mut AnyObject = msg_send![tf, initWithFrame: frame];

        let nsstring_cls = AnyClass::get("NSString").expect("NSString");
        let cstr = CString::new(text).unwrap();
        let ns_text: *mut AnyObject = msg_send![nsstring_cls, stringWithUTF8String: cstr.as_ptr()];
        let _: () = msg_send![tf, setStringValue: ns_text];

        let _: () = msg_send![tf, setEditable: false];
        let _: () = msg_send![tf, setSelectable: false];
        let _: () = msg_send![tf, setBezeled: false];
        let _: () = msg_send![tf, setDrawsBackground: false];
        let _: () = msg_send![tf, setBordered: false];

        let nsfont_cls = AnyClass::get("NSFont").expect("NSFont");
        let font: *mut AnyObject = msg_send![nsfont_cls, systemFontOfSize: font_size];
        let _: () = msg_send![tf, setFont: font];

        let nscolor_cls = AnyClass::get("NSColor").expect("NSColor");
        let color: *mut AnyObject = msg_send![nscolor_cls,
            colorWithSRGBRed: r green: g blue: b alpha: a];
        let _: () = msg_send![tf, setTextColor: color];

        // NSTextAlignment: Left=0, Right=1, Center=2.
        let align_val: i64 = match align {
            TextAlign::Left => 0,
            TextAlign::Right => 1,
            TextAlign::Center => 2,
        };
        let _: () = msg_send![tf, setAlignment: align_val];

        tf
    }

    #[allow(dead_code)]
    enum SymbolWeight { Regular, Medium, Semibold, Bold }
    impl SymbolWeight {
        fn raw(&self) -> f64 {
            match self {
                SymbolWeight::Regular => 0.0,
                SymbolWeight::Medium => 0.23,
                SymbolWeight::Semibold => 0.3,
                SymbolWeight::Bold => 0.4,
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    unsafe fn make_symbol_image_view(
        symbol_name: &str,
        frame: NSRect,
        point_size: f64,
        weight: SymbolWeight,
        r: f64, g: f64, b: f64, a: f64,
    ) -> *mut AnyObject {
        let nsstring_cls = AnyClass::get("NSString").expect("NSString");
        let nsimage_cls = AnyClass::get("NSImage").expect("NSImage");
        let nsimageview_cls = AnyClass::get("NSImageView").expect("NSImageView");
        let nscolor_cls = AnyClass::get("NSColor").expect("NSColor");

        let name_cstr = CString::new(symbol_name).unwrap();
        let ns_name: *mut AnyObject = msg_send![nsstring_cls, stringWithUTF8String: name_cstr.as_ptr()];
        let nil: *mut AnyObject = std::ptr::null_mut();
        let image: *mut AnyObject = msg_send![
            nsimage_cls,
            imageWithSystemSymbolName: ns_name
            accessibilityDescription: nil
        ];

        let sym_cfg_cls = AnyClass::get("NSImageSymbolConfiguration").expect("NSImageSymbolConfiguration");
        let cfg: *mut AnyObject = msg_send![
            sym_cfg_cls,
            configurationWithPointSize: point_size
            weight: weight.raw()
        ];
        let image: *mut AnyObject = msg_send![image, imageWithSymbolConfiguration: cfg];

        let iv: *mut AnyObject = msg_send![nsimageview_cls, alloc];
        let iv: *mut AnyObject = msg_send![iv, initWithFrame: frame];
        let _: () = msg_send![iv, setImage: image];
        let _: () = msg_send![image, setTemplate: true];
        let color: *mut AnyObject = msg_send![
            nscolor_cls,
            colorWithSRGBRed: r green: g blue: b alpha: a
        ];
        let _: () = msg_send![iv, setContentTintColor: color];
        // NSImageScaleNone = 2, NSImageAlignCenter = 0.
        let _: () = msg_send![iv, setImageScaling: 2u64];
        let _: () = msg_send![iv, setImageAlignment: 0u64];
        iv
    }

    unsafe fn set_layer_bg(view: *mut AnyObject, r: f64, g: f64, b: f64, a: f64) {
        let layer: *mut AnyObject = msg_send![view, layer];
        let cg = cg_color(r, g, b, a);
        let _: () = msg_send![layer, setBackgroundColor: cg];
    }

    unsafe fn set_layer_border(view: *mut AnyObject, r: f64, g: f64, b: f64, a: f64) {
        let layer: *mut AnyObject = msg_send![view, layer];
        let cg = cg_color(r, g, b, a);
        let _: () = msg_send![layer, setBorderColor: cg];
    }

    // CGColor is a CoreFoundation opaque pointer (`^{CGColor=}`), not an
    // NSObject. objc2's strict type checking rejects returning it as
    // `*mut AnyObject` (encoded as `@`). Declare an opaque stub whose
    // RefEncode matches the selector's declared return type.
    #[repr(C)]
    struct CGColorStub { _private: [u8; 0] }
    unsafe impl RefEncode for CGColorStub {
        const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("CGColor", &[]));
    }

    unsafe fn cg_color(r: f64, g: f64, b: f64, a: f64) -> *const CGColorStub {
        let nscolor_cls = AnyClass::get("NSColor").expect("NSColor");
        let nscolor: *mut AnyObject = msg_send![nscolor_cls,
            colorWithSRGBRed: r green: g blue: b alpha: a];
        let cg: *const CGColorStub = msg_send![nscolor, CGColor];
        cg
    }
}

/// Creates the native Show More bar. Call once during setup, after
/// pin_launcher_webview, so the bar is added on top of the webview.
pub fn create_show_more_bar<R: Runtime>(window: &WebviewWindow<R>, app_handle: AppHandle<R>) {
    unsafe {
        let nsw = window.ns_window().unwrap() as *mut AnyObject;
        let content_view: *mut AnyObject = msg_send![nsw, contentView];
        let content_frame: NSRect = msg_send![content_view, frame];
        let width = content_frame.size.width;

        show_more_bar::create(content_view, width, move || {
            let _ = app_handle.emit("launcher:show-more-clicked", ());
        });
    }
}

/// Reveals the native Show More bar. Frontend signals first-frame via onMount
/// rAF so this flip lines up with WebKit's first present. `expanded: true` →
/// bar hidden, `false` → bar visible.
pub fn reveal_show_more_bar(expanded: bool) {
    unsafe { show_more_bar::set_hidden(expanded); }
}

/// Applies a color palette to the native Show More bar; components in [0, 1].
pub fn apply_show_more_bar_style(
    bar_bg: (f64, f64, f64, f64),
    text: (f64, f64, f64, f64),
    chip_bg: (f64, f64, f64, f64),
    chip_border: (f64, f64, f64, f64),
) {
    show_more_bar::apply_style(show_more_bar::BarStyle {
        bar_bg,
        text,
        chip_bg,
        chip_border,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn light_theme_maps_to_hud_window_material() {
        let material = material_for_resolved_theme(ResolvedTheme::Light);
        assert_eq!(material, NSVisualEffectMaterial::HudWindow);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn dark_theme_maps_to_hud_window_material() {
        let material = material_for_resolved_theme(ResolvedTheme::Dark);
        assert_eq!(material, NSVisualEffectMaterial::HudWindow);
    }

    /// Embeds the TS source at compile time and extracts
    /// `export const LAUNCHER_HEIGHT_{DEFAULT,COMPACT} = <number>;`. The
    /// Rust constants above must match — any drift in either direction
    /// breaks the compact-launcher invariant (webview pinned at MAX,
    /// window cropped to COMPACT).
    #[test]
    fn heights_match_typescript_source() {
        const TS_SRC: &str =
            include_str!("../../../src/lib/launcher/launcherGeometry.ts");

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

/// Renders SF Symbols to white-on-transparent PNGs that the web layer uses
/// as CSS `mask-image`s, so colour comes from `currentColor` and one cached
/// PNG covers every theme. Rasterised at @3x for Retina; the PNG carries
/// its natural CSS-px size so consumers size correctly.
pub mod sf_symbols {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;
    use std::ffi::CString;
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use objc2_foundation::NSData;
    use objc2::encode::{Encoding, RefEncode};

    // CGImage is an opaque CoreFoundation type, not NSObject — objc2 needs
    // a stub with the right RefEncode to return a pointer to one. Same
    // pattern as CGColorStub in the show-more-bar module.
    #[repr(C)]
    struct CGImageStub { _private: [u8; 0] }
    unsafe impl RefEncode for CGImageStub {
        const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("CGImage", &[]));
    }

    #[derive(serde::Serialize, Clone)]
    pub struct SymbolMask {
        pub png_b64: String,
        pub width: f64,
        pub height: f64,
    }

    static CACHE: Mutex<Option<HashMap<String, SymbolMask>>> = Mutex::new(None);
    /// Hot icons reappear on the next paint and re-render is cheap, so
    /// eviction is "drop everything" once the cap is hit.
    const CACHE_MAX: usize = 256;

    fn cache_key(name: &str, size: f64, weight: &str) -> String {
        format!("{}|{}|{}", name, size as u32, weight)
    }

    /// NSFontWeight values; mirrors SymbolWeight in the show-more-bar module.
    fn weight_to_value(weight: &str) -> f64 {
        match weight {
            "ultralight" => -0.8,
            "thin"       => -0.6,
            "light"      => -0.4,
            "regular"    =>  0.0,
            "medium"     =>  0.23,
            "semibold"   =>  0.3,
            "bold"       =>  0.4,
            "heavy"      =>  0.56,
            "black"      =>  0.62,
            _            =>  0.0,
        }
    }

    pub fn render_sf_symbol_mask(
        name: String,
        size: f64,
        weight: Option<String>,
    ) -> Result<SymbolMask, String> {
        let weight = weight.as_deref().unwrap_or("regular");
        let key = cache_key(&name, size, weight);

        {
            let mut guard = CACHE.lock().map_err(|_| "cache poisoned".to_string())?;
            let map = guard.get_or_insert_with(HashMap::new);
            if let Some(cached) = map.get(&key) {
                return Ok(cached.clone());
            }
        }

        let mask = unsafe { render_symbol_to_png(&name, size, weight)? };

        {
            let mut guard = CACHE.lock().map_err(|_| "cache poisoned".to_string())?;
            let map = guard.get_or_insert_with(HashMap::new);
            if map.len() >= CACHE_MAX {
                map.clear();
            }
            map.insert(key, mask.clone());
        }

        Ok(mask)
    }

    // SAFETY: The AppKit pipeline (NSImage → NSBitmapImageRep) is main-thread
    // only. Tauri dispatches sync commands on the main thread, which is what
    // this expects.
    unsafe fn render_symbol_to_png(name: &str, size: f64, weight: &str) -> Result<SymbolMask, String> {
        let scale: f64 = 3.0;

        let nsstring_cls = AnyClass::get("NSString").ok_or("NSString unavailable")?;
        let nsimage_cls = AnyClass::get("NSImage").ok_or("NSImage unavailable")?;
        let nsbitmap_cls = AnyClass::get("NSBitmapImageRep").ok_or("NSBitmapImageRep unavailable")?;
        let sym_cfg_cls = AnyClass::get("NSImageSymbolConfiguration")
            .ok_or("NSImageSymbolConfiguration unavailable")?;

        let name_cstr = CString::new(name).map_err(|_| "symbol name has nul".to_string())?;
        let ns_name: *mut AnyObject =
            msg_send![nsstring_cls, stringWithUTF8String: name_cstr.as_ptr()];
        let nil: *mut AnyObject = std::ptr::null_mut();

        let image: *mut AnyObject = msg_send![
            nsimage_cls,
            imageWithSystemSymbolName: ns_name
            accessibilityDescription: nil
        ];
        if image.is_null() {
            return Err(format!("unknown SF Symbol: {}", name));
        }

        let cfg: *mut AnyObject = msg_send![
            sym_cfg_cls,
            configurationWithPointSize: size
            weight: weight_to_value(weight)
        ];
        let configured: *mut AnyObject = msg_send![image, imageWithSymbolConfiguration: cfg];
        if configured.is_null() {
            return Err("imageWithSymbolConfiguration returned nil".to_string());
        }
        // Template mode keeps the alpha channel and drops Apple's hierarchical
        // fill colours, so the PNG masks cleanly to currentColor.
        let _: () = msg_send![configured, setTemplate: true];

        // SF Symbols aren't all square. CGImageForProposedRect renders the
        // glyph inside its alignment rect, avoiding the baseline-origin
        // clipping a manual drawInRect: would hit.
        let natural: NSSize = msg_send![configured, size];
        let nat_w = natural.width.max(1.0);
        let nat_h = natural.height.max(1.0);
        let px_w = (nat_w * scale).round();
        let px_h = (nat_h * scale).round();

        let mut proposed = NSRect {
            origin: NSPoint { x: 0.0, y: 0.0 },
            size: NSSize { width: px_w, height: px_h },
        };
        let cg_image: *const CGImageStub = msg_send![
            configured,
            CGImageForProposedRect: &mut proposed as *mut NSRect
            context: nil
            hints: nil
        ];
        if cg_image.is_null() {
            return Err("CGImageForProposedRect returned nil".to_string());
        }

        let bitmap: *mut AnyObject = msg_send![nsbitmap_cls, alloc];
        let bitmap: *mut AnyObject = msg_send![
            bitmap,
            initWithCGImage: cg_image
        ];
        if bitmap.is_null() {
            return Err("NSBitmapImageRep initWithCGImage failed".to_string());
        }

        // Pixel dims stay at @3x; the CSS-px size hint tells consumers how
        // wide the glyph wants to render.
        let natural_size = NSSize { width: nat_w, height: nat_h };
        let _: () = msg_send![bitmap, setSize: natural_size];

        // Retained<NSData> via msg_send_id! avoids the `-[NSData bytes]`
        // type-code mismatch that bites raw msg_send! on _NSInlineData.
        let png_data: Retained<NSData> = msg_send_id![
            bitmap,
            representationUsingType: 4u64
            properties: nil
        ];
        let bytes = png_data.bytes();
        if bytes.is_empty() {
            return Err("PNG data has zero bytes".to_string());
        }
        Ok(SymbolMask {
            png_b64: B64.encode(bytes),
            width: nat_w,
            height: nat_h,
        })
    }
}
