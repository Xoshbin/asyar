#![allow(deprecated)]
use std::sync::Arc;
use tauri::{AppHandle, Manager};

pub use asyar_platform::macos::input::disable_press_and_hold;

pub fn register_cmdq_monitor(app_handle: AppHandle) {
    let app = app_handle.clone();
    asyar_platform::macos::input::register_cmdq_monitor(move || {
        if let Some(sw) = app.get_webview_window("settings") {
            if sw.is_visible().unwrap_or(false) && sw.is_focused().unwrap_or(false) {
                let _ = sw.hide();
                return true;
            }
        }
        for (label, window) in app.webview_windows() {
            let Some(note_id) = crate::sticky_window::note_id_from_label(&label) else {
                continue;
            };
            if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
                let _ = crate::sticky_window::close(&app, note_id);
                return true;
            }
        }
        false
    });
}

pub fn register_snippet_monitor(app_handle: AppHandle) {
    let app = app_handle.clone();
    let buffer = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let buf_reset = std::sync::Arc::clone(&buffer);
    let buf_back = std::sync::Arc::clone(&buffer);
    let buf_char = std::sync::Arc::clone(&buffer);

    let app_active = app.clone();
    let is_active = Arc::new(move || {
        let state = app_active.state::<crate::AppState>();
        !state
            .asyar_visible
            .load(std::sync::atomic::Ordering::Relaxed)
            && state
                .snippets_enabled
                .load(std::sync::atomic::Ordering::Relaxed)
            && !state.is_expanding.load(std::sync::atomic::Ordering::SeqCst)
    });

    let on_reset = Arc::new(move || {
        buf_reset.lock().unwrap_or_else(|p| p.into_inner()).clear();
    });

    let on_backspace = Arc::new(move || {
        buf_back.lock().unwrap_or_else(|p| p.into_inner()).pop();
    });

    let app_char = app.clone();
    let on_char = Arc::new(move |lc| {
        let mut b = buf_char.lock().unwrap_or_else(|p| p.into_inner());
        crate::snippets::process_snippet_char(&app_char, &mut b, lc);
    });

    asyar_platform::macos::input::register_snippet_monitor(
        is_active,
        on_char,
        on_reset,
        on_backspace,
    );
}
