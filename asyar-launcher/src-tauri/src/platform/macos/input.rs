#![allow(deprecated)]
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, msg_send_id};
use objc2_foundation::NSString;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};

/// Disables macOS's "hold key for accented characters" popup for Asyar's
/// own process (issue #433, item 3). WKWebView shows this popup on any
/// focused editable element when a key is held, driven by AppKit's
/// `NSTextInputContext` — a layer below WebKit's DOM event dispatch, so
/// the shortcut recorder's capture-phase `preventDefault()` in
/// `useShortcutCapture.svelte.ts` never reaches it. `NSUserDefaults` is
/// scoped to the calling process's own bundle id, so this does not affect
/// any other app or a system-wide setting.
pub fn disable_press_and_hold() {
    unsafe {
        let defaults_cls = match AnyClass::get("NSUserDefaults") {
            Some(c) => c,
            None => {
                log::warn!("[disable_press_and_hold] NSUserDefaults class not found");
                return;
            }
        };
        let defaults: *mut AnyObject = msg_send![defaults_cls, standardUserDefaults];
        if defaults.is_null() {
            log::warn!("[disable_press_and_hold] standardUserDefaults returned null");
            return;
        }
        let key = NSString::from_str("ApplePressAndHoldEnabled");
        let _: () = msg_send![defaults, setBool: Bool::NO forKey: Retained::as_ptr(&key)];
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
                    let _ = sw.hide();
                    return std::ptr::null_mut();
                }
            }
            // Same treatment for a focused sticky note: Cmd+Q should take that
            // one note off the desktop, not quit Asyar out from under the user.
            // Routed through `sticky_window::close` so it unsticks exactly like
            // the note's own × button (hide + drop the pin).
            for (label, window) in app.webview_windows() {
                let Some(note_id) = crate::sticky_window::note_id_from_label(&label) else {
                    continue;
                };
                if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
                    let _ = crate::sticky_window::close(&app, note_id);
                    return std::ptr::null_mut();
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
            53 => {
                // Escape
                buf.lock().unwrap_or_else(|p| p.into_inner()).clear();
                return;
            }
            36 | 52 => {
                // Return / numpad Enter
                buf.lock().unwrap_or_else(|p| p.into_inner()).clear();
                return;
            }
            48 => {
                // Tab
                buf.lock().unwrap_or_else(|p| p.into_inner()).clear();
                return;
            }
            51 | 117 => {
                // Delete / Forward Delete
                buf.lock().unwrap_or_else(|p| p.into_inner()).pop();
                return;
            }
            123..=126 => {
                // Arrow keys
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
            let merged = {
                let user_guard = state
                    .active_snippets
                    .lock()
                    .unwrap_or_else(|p| p.into_inner());
                let contributed_guard = state
                    .contributed_snippets
                    .lock()
                    .unwrap_or_else(|p| p.into_inner());
                crate::snippets::merge_active_snippets(&user_guard, &contributed_guard)
            };

            for (keyword, expansion) in merged.iter() {
                if current.ends_with(keyword.as_str()) {
                    let kw_len = keyword.chars().count();
                    let exp = expansion.clone();
                    buffer.clear();
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
            let triggers = {
                if let Ok(guard) = state.shortcode_triggers.lock() {
                    guard.clone()
                } else {
                    vec![":".to_string()]
                }
            };
            for trigger in triggers {
                if current.ends_with(&trigger) {
                    if let Some(candidate) =
                        crate::snippets::detect_completed_shortcode_at_end(&current, &trigger)
                    {
                        if !merged.contains_key(&candidate) {
                            let _ = app.emit_to(
                                crate::SPOTLIGHT_LABEL,
                                "shortcode-miss",
                                serde_json::json!({ "shortcode": candidate }),
                            );
                            buffer.clear();
                            break;
                        }
                    }
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
