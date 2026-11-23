//! HUD service — orchestrates window positioning, content emission, and
//! the auto-hide timer.
//!
//! The HUD window is pre-declared in `tauri.conf.json` (label `"hud"`,
//! transparent, decorations off, alwaysOnTop, initially hidden). This
//! module owns the runtime lifecycle.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

use tauri_plugin_store::StoreExt;

use super::placement::Placement;
use crate::error::AppError;
use crate::hud_window::{HudContent, HudState};

/// Window label for the HUD webview, matching `tauri.conf.json`.
pub const HUD_WINDOW_LABEL: &str = "hud";

/// Watchdog for the macOS flash-free reveal: if the HUD route's
/// `hud_mark_shown` echo hasn't flipped alpha back to 1 within this window
/// (webview wedged, event lost), reveal anyway. Two rAFs is the expected
/// path (~33ms); this is the generous upper bound. Worst case equals the
/// pre-dance behavior: a possibly-stale frame, this many ms late.
#[cfg(target_os = "macos")]
const REVEAL_FALLBACK_MS: u64 = 250;

/// Show the HUD with the given title.
///
/// 1. Stores `{title, spinning, reveal_gen}` in `HudState.current` so the
///    HUD route can read it on mount (handles the first-show race where
///    the listener isn't attached yet).
/// 2. Positions the HUD on its target monitor before the webview measures the text.
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
    anchor: Option<[f64; 2]>,
) -> Result<Option<[f64; 2]>, AppError> {
    let window = app
        .get_webview_window(HUD_WINDOW_LABEL)
        .ok_or_else(|| AppError::NotFound("hud window".to_string()))?;

    let state = app.state::<HudState>();
    let reveal_gen = state.reveal_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let placement = resolve_placement(&window, anchor)?;
    let anchor = placement.cursor;
    let (max_width, max_height) = placement.limits();
    let content = HudContent {
        max_width,
        max_height,
        placement,
        title,
        spinning,
        reveal_gen,
    };

    {
        let mut slot = state.current.lock().map_err(|_| AppError::Lock)?;
        *slot = Some(content.clone());
    }

    // Give the first paint a frame on the destination monitor and its DPI.
    fit_window(&window, &content, 160.0, 54.0)?;

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
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
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
                }));
            });
        });
    }

    reset_auto_hide(app, reveal_gen, (!spinning).then_some(duration_ms))?;
    app.emit_to(HUD_WINDOW_LABEL, "hud:show", &content)
        .map_err(|e| AppError::Platform(format!("emit hud:show failed: {e}")))?;

    Ok(anchor)
}

fn reset_auto_hide(
    app: &AppHandle,
    reveal_gen: u64,
    delay_ms: Option<u32>,
) -> Result<(), AppError> {
    let state = app.state::<HudState>();
    let mut timer = state.auto_hide_task.lock().map_err(|_| AppError::Lock)?;
    if state.reveal_gen.load(Ordering::SeqCst) != reveal_gen {
        return Ok(());
    }
    timer.cancel();
    if let Some(ms) = delay_ms {
        let revision = timer.revision;
        let handle = app.clone();
        timer.task = Some(tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(ms.into())).await;
            let app = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                let state = app.state::<HudState>();
                // A hover or replacement can arrive after this callback was queued.
                if state.reveal_gen.load(Ordering::SeqCst) == reveal_gen
                    && state
                        .auto_hide_task
                        .lock()
                        .is_ok_and(|timer| timer.revision == revision)
                {
                    let _ = hide(&app);
                }
            });
        }));
    }
    Ok(())
}

pub fn set_reading(app: &AppHandle, reveal_gen: u64, reading: bool) -> Result<(), AppError> {
    let state = app.state::<HudState>();
    let current = state.current.lock().map_err(|_| AppError::Lock)?;
    if current
        .as_ref()
        .is_some_and(|c| c.reveal_gen == reveal_gen && !c.spinning)
    {
        reset_auto_hide(app, reveal_gen, (!reading).then_some(1000))?;
    }
    Ok(())
}

/// Returns the most recently set HUD content, if any.
pub fn current_state(app: &AppHandle) -> Result<Option<HudContent>, AppError> {
    let state = app.state::<HudState>();
    let slot = state.current.lock().map_err(|_| AppError::Lock)?;
    Ok(slot.clone())
}

/// Fit the window to the measured card, then complete the macOS reveal.
/// Ignore measurements from superseded messages.
pub fn mark_shown(
    app: &AppHandle,
    reveal_gen: u64,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    let state = app.state::<HudState>();
    let current = state.current.lock().map_err(|_| AppError::Lock)?;
    let Some(content) = current.as_ref().filter(|c| c.reveal_gen == reveal_gen) else {
        return Ok(());
    };
    if let Some(window) = app.get_webview_window(HUD_WINDOW_LABEL) {
        fit_window(&window, content, width, height)?;
    }
    drop(current);
    #[cfg(target_os = "macos")]
    {
        let state = app.state::<HudState>();
        if state.reveal_gen.load(Ordering::SeqCst) != reveal_gen {
            return Ok(());
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if let Some(w) = handle.get_webview_window(HUD_WINDOW_LABEL) {
                    crate::platform::macos::set_window_alpha(&w, 1.0);
                }
            }));
        });
    }
    Ok(())
}

/// Hide the HUD window immediately and cancel any pending auto-hide.
pub fn hide(app: &AppHandle) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(HUD_WINDOW_LABEL) {
        let _ = window.hide();
    }
    if let Some(state) = app.try_state::<HudState>() {
        if let Ok(mut current) = state.current.lock() {
            *current = None;
        }
        if let Ok(mut timer) = state.auto_hide_task.lock() {
            timer.cancel();
        }
    }
    Ok(())
}

/// All positions use Tauri physical desktop coordinates, including mixed-DPI displays.
fn resolve_placement<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    anchor: Option<[f64; 2]>,
) -> Result<Placement, AppError> {
    let follow = window
        .app_handle()
        .store("settings.dat")
        .ok()
        .and_then(|store| store.get("settings"))
        .and_then(|s| s.pointer("/appearance/hudFollowCursor")?.as_bool())
        .unwrap_or(false);
    let pointer = if follow || cfg!(target_os = "macos") {
        anchor.or_else(|| window.cursor_position().ok().map(|p| [p.x, p.y]))
    } else {
        None
    };
    let monitor = pointer.and_then(|[x, y]| window.monitor_from_point(x, y).ok().flatten());
    let cursor = if follow && monitor.is_some() {
        pointer
    } else {
        None
    };
    let monitor = monitor
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| AppError::NotFound("HUD monitor".to_string()))?;
    let work = monitor.work_area();
    Ok(Placement {
        work: [
            work.position.x.into(),
            work.position.y.into(),
            work.size.width.into(),
            work.size.height.into(),
        ],
        scale: monitor.scale_factor(),
        cursor,
    })
}

fn fit_window<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    content: &HudContent,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    let placement = &content.placement;
    let width = width.ceil().clamp(1.0, content.max_width);
    let height = height.ceil().clamp(1.0, content.max_height);
    let (x, y) = placement.origin(width, height);
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| AppError::Platform(format!("HUD position: {e}")))?;
    window
        .set_size(PhysicalSize::new(
            (width * placement.scale).ceil() as u32,
            (height * placement.scale).ceil() as u32,
        ))
        .map_err(|e| AppError::Platform(format!("HUD size: {e}")))?;
    Ok(())
}
