//! HUD service — orchestrates window positioning, content emission, and
//! the auto-hide timer.
//!
//! The HUD window is pre-declared in `tauri.conf.json` (label `"hud"`,
//! transparent, decorations off, alwaysOnTop, initially hidden). This
//! module owns the runtime lifecycle.

use std::sync::atomic::Ordering;
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

/// Watchdog for the macOS flash-free reveal: if the HUD route's
/// `hud_mark_shown` echo hasn't flipped alpha back to 1 within this window
/// (webview wedged, event lost), reveal anyway. Two rAFs is the expected
/// path (~33ms); this is the generous upper bound. Worst case equals the
/// pre-dance behavior: a possibly-stale frame, this many ms late.
const REVEAL_FALLBACK_MS: u64 = 250;

/// Show the HUD with the given title.
///
/// 1. Stores `{title, spinning, reveal_gen}` in `HudState.current` so the
///    HUD route can read it on mount (handles the first-show race where
///    the listener isn't attached yet).
/// 2. Positions the HUD window at the bottom-center of the monitor that
///    currently contains the mouse cursor.
/// 3. Shows the window — on macOS, at alpha 0 when it was hidden: the
///    stale composite from the *previous* HUD would otherwise paint for a
///    frame or two before the new title lands (WKWebView keeps rendering
///    on its own pipeline; `show()` composites whatever surface exists at
///    that instant — same failure mode the launcher's two-phase
///    `prepare_show`/`commit_show` solves). Ordering in *before* the emit
///    also unthrottles the hidden webview so its rAF loop is alive to
///    process the event promptly.
/// 4. Emits the `hud:show` event; the route repaints, waits two rAFs, and
///    echoes `hud_mark_shown(reveal_gen)` which flips alpha to 1. A
///    `REVEAL_FALLBACK_MS` watchdog guarantees the reveal even if the echo
///    never arrives.
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
    let reveal_gen = state.reveal_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let content = HudContent {
        title,
        spinning,
        reveal_gen,
    };

    {
        let mut slot = state.current.lock().map_err(|_| AppError::Lock)?;
        *slot = Some(content.clone());
    }

    position_at_bottom_center(&window)?;

    // Alpha-0 only on the hidden→shown transition. When the HUD is already
    // visible (spinner → done swap), the content updates in place like any
    // normal paint — dropping alpha would blink it.
    #[cfg(target_os = "macos")]
    if !window.is_visible().unwrap_or(false) {
        crate::platform::macos::set_window_alpha(&window, 0.0);
    }

    let _ = window.show();

    // Reveal watchdog. Armed on every show (not just the alpha-0 path), and
    // BEFORE the emit below: a show_hud that lands mid-dance takes the
    // already-visible branch above and its own echo/watchdog must be able to
    // finish the reveal the superseded generation can no longer perform (its
    // echo is dropped by the gen check in `mark_shown`); and an emit_to
    // failure error-returns from this function — without the watchdog
    // already armed that would strand the window shown-but-alpha-0.
    #[cfg(target_os = "macos")]
    {
        let app_for_watchdog = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(REVEAL_FALLBACK_MS)).await;
            let handle = app_for_watchdog.clone();
            let _ = app_for_watchdog.run_on_main_thread(move || {
                let state = handle.state::<HudState>();
                if state.reveal_gen.load(Ordering::SeqCst) != reveal_gen {
                    return; // superseded — the newer show owns the reveal
                }
                if let Some(w) = handle.get_webview_window(HUD_WINDOW_LABEL) {
                    if crate::platform::macos::window_alpha(&w) < 1.0 {
                        log::warn!(
                            "[hud] mark_shown echo missing after {REVEAL_FALLBACK_MS}ms; \
                             revealing via watchdog"
                        );
                        crate::platform::macos::set_window_alpha(&w, 1.0);
                    }
                }
            });
        });
    }

    app.emit_to(HUD_WINDOW_LABEL, "hud:show", &content)
        .map_err(|e| AppError::Platform(format!("emit hud:show failed: {e}")))?;

    // Cancel any pending auto-hide; only re-schedule when not spinning.
    {
        let mut slot = state.auto_hide_task.lock().map_err(|_| AppError::Lock)?;
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

/// Completes the flash-free reveal: flips the HUD window's alpha to 1 once
/// the route has painted `reveal_gen`'s content (the route echoes the gen
/// it received after two rAFs). Echoes from a superseded generation are
/// dropped — the newer `show` owns the reveal. No-op on non-macOS, where
/// `show` never drops alpha.
pub fn mark_shown(app: &AppHandle, reveal_gen: u64) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let state = app.state::<HudState>();
        if state.reveal_gen.load(Ordering::SeqCst) != reveal_gen {
            return Ok(());
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(w) = handle.get_webview_window(HUD_WINDOW_LABEL) {
                crate::platform::macos::set_window_alpha(&w, 1.0);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, reveal_gen);
    }
    Ok(())
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
