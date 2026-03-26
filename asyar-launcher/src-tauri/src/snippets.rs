use tauri::{AppHandle, Emitter as _, Manager as _};

#[cfg(target_os = "macos")]
pub fn start_listener(app_handle: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let app = app_handle.clone();
        // NSEvent monitors must be registered on the main thread
        app_handle
            .run_on_main_thread(move || crate::platform::macos::register_snippet_monitor(app))
            .expect("[snippets] failed to schedule NSEvent monitor on main thread");
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
                                .unwrap_or_else(|p: std::sync::PoisonError<_>| p.into_inner());
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
