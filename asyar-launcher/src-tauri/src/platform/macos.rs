#![allow(deprecated)]
use std::path::Path;
use tauri::{monitor, AppHandle, Manager, WebviewWindow, Runtime, Emitter};
use tauri_nspanel::{
    cocoa::{
        appkit::{NSMainMenuWindowLevel, NSWindow, NSWindowCollectionBehavior},
        base::{id, YES},
        foundation::{NSPoint, NSRect},
    },
    objc::{msg_send, sel, sel_impl},
    panel_delegate, Panel, WebviewWindowExt as PanelWebviewWindowExt,
};
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
use std::sync::atomic::Ordering;

/// Configures a window to behave as a macOS Spotlight-style search bar.
pub fn setup_spotlight_window<R: Runtime>(window: &WebviewWindow<R>, app: &AppHandle<R>) -> tauri::Result<Panel> {
    // Convert to panel
    let panel = window.to_panel().map_err(|_| tauri::Error::FailedToReceiveMessage)?;

    // Set panel level
    panel.set_level(NSMainMenuWindowLevel + 1);

    // Allows the panel to display on the same space as the full screen window
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
    );

    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;

    // Ensures the panel cannot activate the App
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);

    // Set up panel delegate
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

    // Apply vibrancy
    apply_vibrancy(window, NSVisualEffectMaterial::HudWindow, None, Some(12.0))
        .expect("Failed to apply vibrancy");

    Ok(panel)
}

/// Retrieves the current frame of the window.
pub fn get_window_frame<R: Runtime>(window: &WebviewWindow<R>) -> NSRect {
    let window_handle = window.ns_window().unwrap() as id;
    // SAFETY: window_handle is a valid NSWindow pointer obtained from Tauri's
    // platform handle; the ObjC runtime guarantees frame() is safe to call on any NSWindow.
    unsafe { window_handle.frame() }
}

/// Updates the window's frame on the screen.
pub fn set_window_frame<R: Runtime>(window: &WebviewWindow<R>, rect: NSRect) {
    let window_handle = window.ns_window().unwrap() as id;
    // SAFETY: window_handle is a valid NSWindow pointer obtained from Tauri's
    // platform handle; the ObjC runtime guarantees frame() is safe to call on any NSWindow.
    unsafe { msg_send![window_handle, setFrame: rect display: YES] }
}

/// Centers the spotlight window on the monitor containing the mouse cursor.
pub fn center_at_cursor_monitor<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let monitor = monitor::get_monitor_with_cursor()
        .ok_or_else(|| tauri::Error::FailedToReceiveMessage)?;

    let monitor_scale_factor = monitor.scale_factor();
    let monitor_size = monitor.size().to_logical::<f64>(monitor_scale_factor);
    let monitor_position = monitor.position().to_logical::<f64>(monitor_scale_factor);

    let window_frame = get_window_frame(window);

    let rect = NSRect {
        origin: NSPoint {
            x: (monitor_position.x + (monitor_size.width / 2.0))
                - (window_frame.size.width / 2.0),
            y: (monitor_position.y + (monitor_size.height / 2.0))
                - (window_frame.size.height / 2.0),
        },
        size: window_frame.size,
    };

    set_window_frame(window, rect);
    Ok(())
}

/// Extracts the high-resolution PNG icon from a macOS .app bundle.
pub fn extract_icon(path: &Path) -> Option<Vec<u8>> {
    let plist_path = path.join("Contents/Info.plist");

    // Read CFBundleIconFile from Info.plist
    let icon_name: String = plist::from_file::<_, plist::Value>(&plist_path)
        .ok()
        .and_then(|v| v.into_dictionary())
        .and_then(|d| d.get("CFBundleIconFile").cloned())
        .and_then(|v| v.into_string())
        .unwrap_or_else(|| "AppIcon".to_string());

    // Add .icns extension if missing
    let icon_filename = if icon_name.ends_with(".icns") {
        icon_name
    } else {
        format!("{}.icns", icon_name)
    };

    let icns_path = path.join("Contents/Resources").join(&icon_filename);

    // Fall back to scanning Resources for any .icns file
    let icns_path = if icns_path.exists() {
        icns_path
    } else {
        let resources_dir = path.join("Contents/Resources");
        std::fs::read_dir(&resources_dir)
            .ok()?
            .filter_map(|e| e.ok())
            .find(|e| e.path().extension().map(|x| x == "icns").unwrap_or(false))
            .map(|e| e.path())?
    };

    // Parse .icns and extract a best available PNG image
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

    // Fallback to any icon
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

/// Registers the global NSEvent monitor to detect typed snippets.
pub fn register_snippet_monitor(app_handle: AppHandle) {
    use block2::StackBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{msg_send, msg_send_id};
    use std::sync::{Arc, Mutex};

    // SAFETY: Called on the main thread (enforced by the .run_on_main_thread() call site).
    // All ObjC msg_send! calls operate on valid Objective-C objects obtained from the runtime.

    // NSEventMaskKeyDown = 1 << NSEventTypeKeyDown (10)
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
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

/// Returns `true` if the process has been granted macOS Accessibility permission.
pub fn is_accessibility_trusted() -> bool {
    // SAFETY: AXIsProcessTrusted is a pure query function with no side effects;
    // it is safe to call at any time from any thread.
    unsafe { AXIsProcessTrusted() }
}

/// Opens the macOS Accessibility preferences pane so the user can grant permission.
pub fn open_accessibility_prefs() {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
}

/// Returns the process ID of the frontmost (background) application.
/// Since Asyar uses NSWindowStyleMaskNonActivatingPanel, the background app
/// remains the frontmost even while Asyar's panel is visible.
pub fn get_frontmost_app_pid() -> Option<i32> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

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

