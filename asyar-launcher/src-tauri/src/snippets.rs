use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "macos")]
pub fn start_listener(app_handle: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let app = app_handle.clone();
        // NSEvent monitors must be registered on the main thread
        app_handle
            .run_on_main_thread(move || unsafe { register_monitor(app) })
            .expect("[snippets] failed to schedule NSEvent monitor on main thread");
    }
}

#[cfg(target_os = "macos")]
unsafe fn register_monitor(app_handle: AppHandle) {
    use block2::StackBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{msg_send, msg_send_id};
    use std::sync::{Arc, Mutex};

    // NSEventMaskKeyDown = 1 << NSEventTypeKeyDown (10)
    const KEY_DOWN_MASK: u64 = 1u64 << 10;

    let buffer: Arc<Mutex<Vec<char>>> = Arc::new(Mutex::new(Vec::new()));
    let buf = Arc::clone(&buffer);
    let app = app_handle.clone();

    let handler = StackBlock::new(move |event: *mut AnyObject| {
        let state = app.state::<crate::AppState>();

        // NSEvent monitors don't fire when our app is focused, but check anyway
        if state.asyar_visible.load(Ordering::Relaxed)
            || !state.snippets_enabled.load(Ordering::Relaxed)
        {
            buf.lock().unwrap_or_else(|p| p.into_inner()).clear();
            return;
        }

        // keyCode is layout-independent; use it for special keys
        let keycode: u16 = msg_send![event, keyCode];
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

        // Get typed characters (layout-aware, handles accents)
        // Use charactersIgnoringModifiers to get the base key (e.g. 'a' not 'A' when Shift held)
        let chars_obj: Option<Retained<AnyObject>> =
            msg_send_id![event, charactersIgnoringModifiers];

        if let Some(chars) = chars_obj {
            let utf8: *const i8 = msg_send![&*chars, UTF8String];
            if utf8.is_null() {
                return;
            }
            let s = std::ffi::CStr::from_ptr(utf8)
                .to_str()
                .unwrap_or("")
                .to_string();

            let mut buffer = buf.lock().unwrap_or_else(|p| p.into_inner());
            for c in s.chars() {
                if c.is_control() {
                    continue;
                }
                // Store lowercase so keywords are case-insensitive
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
                    let _ = app.emit(
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

    // Register the global monitor — ObjC runtime copies the block internally
    let ns_event_cls = AnyClass::get("NSEvent").expect("NSEvent class not found");
    let monitor: Option<Retained<AnyObject>> = msg_send_id![
        ns_event_cls,
        addGlobalMonitorForEventsMatchingMask: KEY_DOWN_MASK,
        handler: &handler
    ];

    // Leak the monitor object — we want it alive for the entire app lifetime
    if let Some(m) = monitor {
        Box::leak(Box::new(m));
    } else {
        log::error!("[snippets] NSEvent monitor registration failed — Accessibility permission may be needed");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn start_listener(app_handle: AppHandle) {
    std::thread::spawn(move || {
        use rdev::{listen, EventType, Key};
        use std::sync::atomic::Ordering;

        let mut buffer: Vec<char> = Vec::new();
        const MAX_LEN: usize = 64;

        if let Err(e) = listen(move |event| {
            let state = app_handle.state::<crate::AppState>();

            if state.asyar_visible.load(Ordering::Relaxed)
                || !state.snippets_enabled.load(Ordering::Relaxed)
            {
                buffer.clear();
                return;
            }

            if let EventType::KeyPress(key) = event.event_type {
                match key {
                    Key::Escape
                    | Key::Return
                    | Key::Tab
                    | Key::UpArrow
                    | Key::DownArrow
                    | Key::LeftArrow
                    | Key::RightArrow => {
                        buffer.clear();
                    }
                    Key::Backspace => {
                        buffer.pop();
                    }
                    _ => {
                        if let Some(c) = win_linux_key_to_char(&key) {
                            buffer.push(c);
                            if buffer.len() > MAX_LEN {
                                buffer.remove(0);
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
                                    let _ = app_handle.emit(
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
                    }
                }
            }
        }) {
            log::error!("[snippets] rdev listen error: {:?}", e);
        }
    });
}

/// Maps rdev Key to lowercase char for Windows/Linux.
/// Only maps printable, unshifted characters. Keywords must use lowercase letters.
#[cfg(not(target_os = "macos"))]
fn win_linux_key_to_char(key: &rdev::Key) -> Option<char> {
    use rdev::Key;
    match key {
        Key::KeyA => Some('a'), Key::KeyB => Some('b'), Key::KeyC => Some('c'),
        Key::KeyD => Some('d'), Key::KeyE => Some('e'), Key::KeyF => Some('f'),
        Key::KeyG => Some('g'), Key::KeyH => Some('h'), Key::KeyI => Some('i'),
        Key::KeyJ => Some('j'), Key::KeyK => Some('k'), Key::KeyL => Some('l'),
        Key::KeyM => Some('m'), Key::KeyN => Some('n'), Key::KeyO => Some('o'),
        Key::KeyP => Some('p'), Key::KeyQ => Some('q'), Key::KeyR => Some('r'),
        Key::KeyS => Some('s'), Key::KeyT => Some('t'), Key::KeyU => Some('u'),
        Key::KeyV => Some('v'), Key::KeyW => Some('w'), Key::KeyX => Some('x'),
        Key::KeyY => Some('y'), Key::KeyZ => Some('z'),
        Key::Num0 => Some('0'), Key::Num1 => Some('1'), Key::Num2 => Some('2'),
        Key::Num3 => Some('3'), Key::Num4 => Some('4'), Key::Num5 => Some('5'),
        Key::Num6 => Some('6'), Key::Num7 => Some('7'), Key::Num8 => Some('8'),
        Key::Num9 => Some('9'),
        Key::SemiColon => Some(';'), Key::Minus => Some('-'),
        Key::Equal => Some('='), Key::LeftBracket => Some('['),
        Key::RightBracket => Some(']'), Key::BackSlash => Some('\\'),
        Key::Quote => Some('\''), Key::Comma => Some(','),
        Key::Dot => Some('.'), Key::Slash => Some('/'),
        Key::BackQuote => Some('`'), Key::Space => Some(' '),
        _ => None,
    }
}
