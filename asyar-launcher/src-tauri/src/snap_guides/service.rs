//! Snap-guides window service — show/hide/paint, and nothing else. See
//! `mod.rs` for why this module has no opinion on *when* to show itself.

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime};

use crate::error::AppError;
use crate::snap_guides::{SnapGuideState, SnapGuidesState};

/// Window label, matching `tauri.conf.json`.
pub const SNAP_GUIDES_WINDOW_LABEL: &str = "snap-guides";

/// Sizes and positions the guide window to exactly cover the given monitor
/// (`origin`/`size` in logical px, absolute desktop coordinates — the same
/// space `window_drag`'s live `(x, y)` already uses, so callers don't need
/// any AppKit-space conversion), then shows it.
pub fn show<R: Runtime>(
    app: &AppHandle<R>,
    origin: (f64, f64),
    size: (f64, f64),
) -> Result<(), AppError> {
    let window = app
        .get_webview_window(SNAP_GUIDES_WINDOW_LABEL)
        .ok_or_else(|| AppError::NotFound("snap-guides window".to_string()))?;

    window
        .set_size(tauri::Size::Logical(LogicalSize {
            width: size.0,
            height: size.1,
        }))
        .map_err(|e| AppError::Platform(format!("snap-guides set_size: {e}")))?;
    window
        .set_position(tauri::Position::Logical(LogicalPosition {
            x: origin.0,
            y: origin.1,
        }))
        .map_err(|e| AppError::Platform(format!("snap-guides set_position: {e}")))?;
    let _ = window.show();
    #[cfg(target_os = "linux")]
    {
        // On Linux, set_ignore_cursor_events must be deferred until after the window is shown/realized
        let _ = window.set_ignore_cursor_events(true);
    }
    Ok(())
}

/// Hides the guide window and clears the remembered state, so a fresh drag
/// later doesn't briefly flash the previous drag's guide positions before
/// its first `set_state` call lands.
pub fn hide<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(SNAP_GUIDES_WINDOW_LABEL) {
        let _ = window.hide();
    }
    if let Some(state) = app.try_state::<SnapGuidesState>() {
        if let Ok(mut slot) = state.current.lock() {
            *slot = None;
        }
    }
    Ok(())
}

/// Records `state` and pushes it to the guide route.
pub fn set_state<R: Runtime>(app: &AppHandle<R>, state: SnapGuideState) -> Result<(), AppError> {
    if let Some(managed) = app.try_state::<SnapGuidesState>() {
        if let Ok(mut slot) = managed.current.lock() {
            *slot = Some(state.clone());
        }
    }
    app.emit_to(SNAP_GUIDES_WINDOW_LABEL, "snap-guides:state", &state)
        .map_err(|e| AppError::Platform(format!("emit snap-guides:state failed: {e}")))?;
    Ok(())
}

/// The most recently set guide state, if any — the route calls this on
/// mount to recover state emitted before its listener attached.
pub fn current_state<R: Runtime>(app: &AppHandle<R>) -> Option<SnapGuideState> {
    app.try_state::<SnapGuidesState>()?
        .current
        .lock()
        .ok()?
        .clone()
}
