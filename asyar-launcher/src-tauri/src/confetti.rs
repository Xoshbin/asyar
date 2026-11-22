//! Full-screen confetti: a pre-declared transparent, click-through,
//! always-on-top window (label `"confetti"`, `tauri.conf.json`) stretched
//! over the monitor under the cursor for one burst, then hidden again.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppError;

pub const CONFETTI_WINDOW_LABEL: &str = "confetti";

/// How long the window stays up; the route's animation fits inside it.
const BURST_DURATION: Duration = Duration::from_millis(4500);

/// Latest burst's generation; held while starting a burst and while hiding,
/// so an older burst's timer can never hide a newer one.
static GENERATION: Mutex<u64> = Mutex::new(0);

pub fn show(app: &AppHandle) -> Result<(), AppError> {
    let mut generation = GENERATION.lock().unwrap_or_else(|e| e.into_inner());
    *generation += 1;
    let burst = *generation;

    let window = app
        .get_webview_window(CONFETTI_WINDOW_LABEL)
        .ok_or_else(|| AppError::NotFound("confetti window".to_string()))?;

    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| AppError::NotFound("monitor for confetti".to_string()))?;
    window
        .set_size(*monitor.size())
        .map_err(|e| AppError::Platform(format!("confetti set_size: {e}")))?;
    window
        .set_position(*monitor.position())
        .map_err(|e| AppError::Platform(format!("confetti set_position: {e}")))?;
    let _ = window.show();
    // Must follow show(): ignoring cursor events on an unrealized window aborts on Linux/Windows.
    let _ = window.set_ignore_cursor_events(true);
    app.emit_to(CONFETTI_WINDOW_LABEL, "confetti:burst", ())
        .map_err(|e| AppError::Platform(format!("emit confetti:burst failed: {e}")))?;

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(BURST_DURATION);
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let current = GENERATION.lock().unwrap_or_else(|e| e.into_inner());
            if *current != burst {
                return;
            }
            if let Some(w) = inner.get_webview_window(CONFETTI_WINDOW_LABEL) {
                let _ = w.hide();
            }
        });
    });
    Ok(())
}
