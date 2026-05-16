//! HUD service — orchestrates window positioning, content emission, and
//! the auto-hide timer.
//!
//! The HUD window is pre-declared in `tauri.conf.json` (label `"hud"`,
//! transparent, decorations off, alwaysOnTop, initially hidden). This
//! module owns the runtime lifecycle.

use std::time::Duration;

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager};

use crate::error::AppError;
use crate::hud_window::{HudContent, HudState};

/// Window label for the HUD webview, matching `tauri.conf.json`.
pub const HUD_WINDOW_LABEL: &str = "hud";

/// Logical pixel dimensions of the HUD window.
///
/// These MUST match the `width`/`height` declared in `tauri.conf.json` for
/// the `"hud"` window. We hardcode them here instead of querying
/// `window.outer_size()` because that returns 0×0 on a window that has not
/// yet been shown — and the HUD window is declared `visible: false`, so the
/// very first `show_hud` call would query 0×0 and compute a corner-of-screen
/// position instead of bottom-center.
const HUD_WIDTH: f64 = 360.0;
const HUD_HEIGHT: f64 = 80.0;

/// Margin between the HUD and the bottom edge of the active monitor (logical px).
const HUD_BOTTOM_MARGIN: f64 = 80.0;

/// Show the HUD with the given title.
///
/// 1. Stores `{title, spinning}` in `HudState.current` so the HUD route can
///    read it on mount (handles the first-show race where the listener
///    isn't attached yet).
/// 2. Positions the HUD window at the bottom-center of the monitor that
///    currently contains the mouse cursor.
/// 3. Emits the `hud:show` event with the content payload.
/// 4. Shows the window.
/// 5. When `spinning=false`, cancels any pending auto-hide and schedules
///    a new one for `duration_ms`. When `spinning=true`, cancels any
///    pending auto-hide and does NOT schedule a new one — the HUD stays
///    visible until an explicit `hide_hud` or a follow-up non-spinning
///    `show_hud` call replaces the state.
pub fn show(
    app: &AppHandle,
    title: String,
    duration_ms: u32,
    spinning: bool,
) -> Result<(), AppError> {
    log::info!("[hud] show(title={title:?}, duration_ms={duration_ms}, spinning={spinning})");
    let window = app
        .get_webview_window(HUD_WINDOW_LABEL)
        .ok_or_else(|| AppError::NotFound("hud window".to_string()))?;

    let state = app.state::<HudState>();
    let content = HudContent {
        title,
        spinning,
    };

    {
        let mut slot = state
            .current
            .lock()
            .map_err(|_| AppError::Lock)?;
        *slot = Some(content.clone());
    }

    position_at_bottom_center(&window)?;

    app.emit_to(HUD_WINDOW_LABEL, "hud:show", &content)
        .map_err(|e| AppError::Platform(format!("emit hud:show failed: {e}")))?;

    let _ = window.show();

    // Cancel any pending auto-hide; only re-schedule when not spinning.
    {
        let mut slot = state
            .auto_hide_task
            .lock()
            .map_err(|_| AppError::Lock)?;
        if let Some(prev) = slot.take() {
            prev.abort();
        }
        if !spinning {
            let app_for_task = app.clone();
            let handle = tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(duration_ms as u64)).await;
                let _ = hide(&app_for_task);
            });
            *slot = Some(handle);
        }
    }

    Ok(())
}

/// Returns the most recently set HUD content, if any.
pub fn current_state(app: &AppHandle) -> Result<Option<HudContent>, AppError> {
    let state = app.state::<HudState>();
    let slot = state.current.lock().map_err(|_| AppError::Lock)?;
    Ok(slot.clone())
}

/// Hide the HUD window immediately and cancel any pending auto-hide.
pub fn hide(app: &AppHandle) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(HUD_WINDOW_LABEL) {
        let _ = window.hide();
    }
    if let Some(state) = app.try_state::<HudState>() {
        if let Ok(mut slot) = state.auto_hide_task.lock() {
            if let Some(prev) = slot.take() {
                prev.abort();
            }
        }
    }
    Ok(())
}

/// Positions the HUD window at the bottom-center of the monitor containing
/// the mouse cursor, and ensures the OS frame matches the declared HUD size.
///
/// We force `set_size` BEFORE `set_position` because Tauri 2 on macOS may
/// not initialize a never-shown window's frame from `tauri.conf.json` until
/// the first `show()` — without this, `outer_size()` reads 0×0 and any
/// centering math degenerates to a corner-of-screen position.
fn position_at_bottom_center<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    let m = monitor::get_monitor_with_cursor()
        .ok_or_else(|| AppError::NotFound("active monitor".to_string()))?;

    #[cfg(not(target_os = "macos"))]
    let m = window
        .primary_monitor()
        .map_err(|e| AppError::Platform(format!("primary_monitor: {e}")))?
        .ok_or_else(|| AppError::NotFound("primary monitor".to_string()))?;

    let scale = m.scale_factor();
    let monitor_size = m.size().to_logical::<f64>(scale);
    let monitor_position = m.position().to_logical::<f64>(scale);

    // Force the window to its declared size before positioning, so that
    // (a) the OS has a real frame to move and (b) the centering math below
    // uses the correct dimensions.
    window
        .set_size(tauri::Size::Logical(LogicalSize {
            width: HUD_WIDTH,
            height: HUD_HEIGHT,
        }))
        .map_err(|e| AppError::Platform(format!("hud set_size: {e}")))?;

    let x = monitor_position.x + (monitor_size.width - HUD_WIDTH) / 2.0;
    let y = monitor_position.y + monitor_size.height - HUD_HEIGHT - HUD_BOTTOM_MARGIN;

    log::info!(
        "[hud] positioning at logical ({x:.0}, {y:.0}) on monitor ({:.0}x{:.0} @ {:.0},{:.0}) scale={scale}",
        monitor_size.width,
        monitor_size.height,
        monitor_position.x,
        monitor_position.y,
    );

    window
        .set_position(tauri::Position::Logical(LogicalPosition { x, y }))
        .map_err(|e| AppError::Platform(format!("hud set_position: {e}")))?;
    Ok(())
}
