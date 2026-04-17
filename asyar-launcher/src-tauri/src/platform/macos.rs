#![allow(deprecated)]
use std::path::Path;
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

/// Configures a window to behave as a macOS Spotlight-style search bar.
pub fn setup_spotlight_window<R: Runtime>(window: &WebviewWindow<R>, app: &AppHandle<R>) -> tauri::Result<Panel> {
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

    apply_vibrancy(window, NSVisualEffectMaterial::HudWindow, None, Some(12.0))
        .expect("Failed to apply vibrancy");

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

/// Launcher heights — pinned at MAX, cropped to COMPACT by NSWindow resize.
/// Mirrors `LAUNCHER_HEIGHT_{DEFAULT,COMPACT}` in
/// `asyar-launcher/src/lib/launcher/launcherGeometry.ts`. The unit test
/// `heights_match_typescript_source` at the bottom of this file embeds the
/// TS source via `include_str!` and fails if these values drift.
pub const LAUNCHER_MAX_HEIGHT: f64 = 560.0;
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

        // Clip contentView to a 12px rounded rect so all subviews share the
        // same mask — window_vibrancy only rounds the vibrancy view, and once
        // the webview is pinned on top its square corners cover vibrancy's.
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content_view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: 12.0_f64];
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

/// Atomically resize the NSWindow (top edge pinned), reposition the pinned
/// webview + vibrancy layer, and toggle the native Show More bar — one
/// main-thread turn, one CATransaction. `expanded: None` leaves bar visibility
/// alone; `Some(true)` hides it, `Some(false)` shows it.
pub fn set_launcher_window_height<R: Runtime>(
    window: &WebviewWindow<R>,
    height: f64,
    expanded: Option<bool>,
) {
    let nsw = window.ns_window().unwrap() as *mut AnyObject;
    unsafe {
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
        border: usize,
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

            // 1px top border.
            let border = make_plain_view(NSRect {
                origin: NSPoint { x: 0.0, y: SHOW_MORE_BAR_HEIGHT - 1.0 },
                size: NSSize { width: content_width, height: 1.0 },
            });
            let _: () = msg_send![border, setAutoresizingMask: 2u64];
            set_layer_bg(border, 90.0 / 255.0, 90.0 / 255.0, 95.0 / 255.0, 0.5);
            let _: () = msg_send![bar, addSubview: border];

            // Key-hint chip — 22×18 rounded rect, pinned right, vertically centered.
            let chip_width = 22.0;
            let chip_height = 18.0;
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
            let _: () = msg_send![chip_layer, setCornerRadius: 5.0_f64];
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

            // "Show More" label — right-aligned, left of the chip.
            let label_right_margin = chip_right_margin + chip_width + 6.0;
            let label_width = 100.0;
            let label_height = 18.0;
            let label_y = (SHOW_MORE_BAR_HEIGHT - label_height) / 2.0;
            let label_x = content_width - label_right_margin - label_width;
            let label = make_label(
                "Show More",
                NSRect {
                    origin: NSPoint { x: label_x, y: label_y },
                    size: NSSize { width: label_width, height: label_height },
                },
                13.0,
                235.0 / 255.0, 235.0 / 255.0, 245.0 / 255.0, 0.65,
                TextAlign::Right,
            );
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
                border: border as usize,
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
        pub border: (f64, f64, f64, f64),
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
            let border: *mut AnyObject = views.border as *mut AnyObject;
            let chip: *mut AnyObject = views.chip as *mut AnyObject;
            let label: *mut AnyObject = views.label as *mut AnyObject;
            let glyph: *mut AnyObject = views.glyph as *mut AnyObject;

            set_layer_bg(bar, style.bar_bg.0, style.bar_bg.1, style.bar_bg.2, style.bar_bg.3);
            set_layer_bg(border, style.border.0, style.border.1, style.border.2, style.border.3);
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
    border: (f64, f64, f64, f64),
    text: (f64, f64, f64, f64),
    chip_bg: (f64, f64, f64, f64),
    chip_border: (f64, f64, f64, f64),
) {
    show_more_bar::apply_style(show_more_bar::BarStyle {
        bar_bg,
        border,
        text,
        chip_bg,
        chip_border,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

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
