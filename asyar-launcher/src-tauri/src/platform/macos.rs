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
use objc2_foundation::{NSString, NSRect, NSPoint};

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
    unsafe { msg_send![window_handle, setFrame: rect display: Bool::YES] }
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
