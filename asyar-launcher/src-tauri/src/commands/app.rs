//! Window visibility and focus-lock commands.
//!
//! `show`/`hide` are single-shot; `prepare_show` + `commit_show` is the
//! flash-free reveal path documented on those functions.

use crate::error::AppError;
use crate::{AppState, SPOTLIGHT_LABEL};
use std::sync::atomic::Ordering;
use tauri::AppHandle;
use tauri::Manager;
#[cfg(not(target_os = "macos"))]
use tauri::{LogicalPosition, Position};
#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;

/// Off-screen coordinate used on Windows/Linux to make the window invisible
/// while keeping it mapped, so the webview's render process stays in its
/// "visible" activity state and keeps pushing frames.
#[cfg(not(target_os = "macos"))]
const OFFSCREEN_COORD: f64 = -30_000.0;

/// Phase 1 of the flash-free reveal: make the launcher imperceptible but
/// mapped, so the webview resumes rendering without the user seeing the
/// stale cached frame. The JS caller awaits two rAFs after this returns
/// before calling `commit_show`.
///
/// Under the parked-panel lifecycle (see `park_launcher_panel`) the panel is
/// normally already mapped at alpha 0 and rendering; callers that swap the
/// view before revealing (user-item hotkeys) still need the two-rAF wait so
/// the *new* view has painted before the alpha flip.
#[tauri::command]
pub fn prepare_show(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    // Intentionally NOT setting asyar_visible here: the panel is mapped but
    // imperceptible until commit_show runs. A concurrent caller reading
    // is_visible during this window must still take the two-phase path,
    // not the single-shot `show` that would composite at alpha 1 mid-prepare.
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle
            .get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|_| AppError::NotFound("launcher panel".to_string()))?;
        let window = app_handle
            .get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        // Alpha 0 first so nothing composites visibly; panel.show() takes
        // key focus while still invisible so keys typed during the two-rAF
        // window land in the DOM. Mouse events come back on here, not at
        // commit.
        crate::platform::macos::set_window_alpha(&window, 0.0);
        crate::platform::macos::set_ignores_mouse_events(&window, false);
        panel.show();
    }
    #[cfg(not(target_os = "macos"))]
    {
        capture_previous_foreground(&state)?;
        let window = app_handle
            .get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        // Move off-screen before showing: the window stays in the compositor's
        // visible set (so WebView2/WebKitGTK keep pushing frames) but the user
        // can't see it. commit_show restores the final position.
        let _ = window.set_position(Position::Logical(LogicalPosition {
            x: OFFSCREEN_COORD,
            y: OFFSCREEN_COORD,
        }));
        let _ = window.show();
        #[cfg(target_os = "linux")]
        crate::mark_launcher_shown(&state);
    }
    let _ = state;
    Ok(())
}

/// Phase 2 of the flash-free reveal: position the launcher correctly and
/// reveal it. By the time the JS caller invokes this (after two rAFs) the
/// webview has already committed at least one fresh frame while imperceptible,
/// so the user sees the target UI immediately.
#[tauri::command]
pub fn commit_show(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let window = app_handle
            .get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        crate::platform::macos::position_launcher(&window)?;
        crate::platform::macos::set_window_alpha(&window, 1.0);
        // prepare_show's panel.show() ran on an already-visible (parked)
        // panel, which doesn't rebuild the responder chain; without this,
        // typed keys can dead-end at wry's parent view.
        crate::platform::macos::reseat_first_responder(&window);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = app_handle
            .get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        crate::launcher_placement::service::apply(&app_handle)?;
        let _ = window.set_focus();
        #[cfg(target_os = "linux")]
        crate::mark_launcher_shown(&state);
    }
    // Flip the visibility flag only after the panel is actually composited at
    // its final position and alpha — otherwise a concurrent showWindow() that
    // reads is_visible mid-prepare would take the single-shot `show` path and
    // composite at alpha 1 before the new view has committed a fresh frame.
    state.asyar_visible.store(true, Ordering::Relaxed);
    Ok(())
}

/// Single-shot reveal for callers that know the panel is already visible
/// (no stale-frame risk, so no need for the two-phase dance). Also the
/// fallback used by the shortcut service when its `panel_is_visible` check
/// reports true.
#[tauri::command]
pub fn show(app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    state.asyar_visible.store(true, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle
            .get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|_| AppError::NotFound("launcher panel".to_string()))?;
        let window = app_handle
            .get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher panel window".to_string()))?;
        crate::platform::macos::reveal_launcher_panel(&window, &panel);
    }
    #[cfg(not(target_os = "macos"))]
    {
        capture_previous_foreground(&state)?;
        let window = app_handle
            .get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        crate::launcher_placement::service::apply(&app_handle)?;
        let _ = window.show();
        let _ = window.set_focus();
        #[cfg(target_os = "linux")]
        crate::mark_launcher_shown(&state);
    }
    Ok(())
}

/// Returns whether the launcher is currently intended to be visible. Mirrors
/// the `asyar_visible` atomic; the JS side reads this to decide whether to
/// use the two-phase reveal or the single-shot `show` fallback.
#[tauri::command]
pub fn is_visible(state: tauri::State<'_, AppState>) -> bool {
    state.asyar_visible.load(Ordering::Relaxed)
}

/// Hides the launcher window. On macOS "hidden" means parked (ordered in at
/// alpha 0, mouse-transparent; see `park_launcher_panel`), so the webview
/// keeps rendering and the post-hide state reset the frontend performs is
/// composited before the next reveal. Focus returns to the previous app via
/// park's order-out/order-in pair when the panel still owns key.
#[tauri::command]
pub fn hide(app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    state.asyar_visible.store(false, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle
            .get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|_| AppError::NotFound("launcher panel".to_string()))?;
        let window = app_handle
            .get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        crate::platform::macos::park_launcher_panel(&window, &panel);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = app_handle
            .get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            #[cfg(target_os = "windows")]
            {
                let prev = *state.previous_hwnd.lock().map_err(|_| AppError::Lock)?;
                crate::platform::windows::restore_foreground_window(prev);
            }
        }
    }
    Ok(())
}

/// On Windows/Linux, remember which window was frontmost before we steal
/// focus, so `hide` can restore it.
#[cfg(not(target_os = "macos"))]
fn capture_previous_foreground(state: &tauri::State<'_, AppState>) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let prev = crate::platform::windows::capture_foreground_window();
        let mut previous_hwnd = state.previous_hwnd.lock().map_err(|_| AppError::Lock)?;
        *previous_hwnd = prev;
    }
    #[cfg(target_os = "linux")]
    {
        let wid = crate::window_management::linux::capture_active_window_id();
        let mut prev = state
            .linux_prev_window_id
            .lock()
            .map_err(|_| AppError::Lock)?;
        *prev = wid;
    }
    let _ = state;
    Ok(())
}

/// Locks or unlocks keyboard focus to prevent the window from losing focus.
#[tauri::command]
pub fn set_focus_lock(state: tauri::State<'_, AppState>, locked: bool) {
    state.focus_locked.store(locked, Ordering::Relaxed);
}

/// Mirrors `!isCompactIdle` from the launcher frontend so the panel resign
/// handler can tell whether the window is in a committed expanded state
/// (typed query, active extension view, active context chip, Show More)
/// that must survive hide/show without racing JS. TS owns the decision;
/// this command is a pure sink.
#[tauri::command]
pub fn set_launcher_keep_expanded(state: tauri::State<'_, AppState>, keep_expanded: bool) {
    state
        .launcher_keep_expanded
        .store(keep_expanded, Ordering::Relaxed);
}

/// Marks the in-flight presentation-gated resize's content as painted.
/// Called from a rAF in the same webview rendering update that builds the
/// new view's paint, so the gated resize commits in the same render-server
/// commit as that paint (see `platform::macos::confirm_launcher_paint`).
#[tauri::command]
pub fn confirm_launcher_paint() {
    #[cfg(target_os = "macos")]
    crate::platform::macos::confirm_launcher_paint();
}

/// Withdraws an in-flight presentation-gated resize whose confirm will
/// never arrive (the frontend deferred a reversal mid-transition instead).
/// The armed sentinel and its watchdog drop via the generation check.
#[tauri::command]
pub fn cancel_launcher_resize() {
    #[cfg(target_os = "macos")]
    crate::platform::macos::cancel_pending_resize();
}

/// Validates a launcher height value before it reaches platform window APIs.
/// Rejects NaN, Infinity, and values outside the allowed range.
fn validate_launcher_height(height: f64) -> Result<(), AppError> {
    if !height.is_finite() {
        return Err(AppError::Validation(format!(
            "launcher height must be finite, got {height}"
        )));
    }
    if !(50.0..=2000.0).contains(&height) {
        return Err(AppError::Validation(format!(
            "launcher height must be between 50 and 2000, got {height}"
        )));
    }
    Ok(())
}

/// Resizes the launcher window height, keeping the top edge pinned. On macOS
/// `defer_until_next_ca_commit: Some(true)` gates the resize on the current
/// CA transaction's pre-commit phase;
/// `after_next_presentation_update: Some(true)` gates it on WebKit's next
/// *confirmed* WebContent paint (every visible compact↔expanded transition)
/// and wins over the CA gate.
#[tauri::command]
pub fn set_launcher_height(
    app_handle: AppHandle,
    height: f64,
    defer_until_next_ca_commit: Option<bool>,
    after_next_presentation_update: Option<bool>,
) -> Result<(), AppError> {
    validate_launcher_height(height)?;
    let window = app_handle
        .get_webview_window(SPOTLIGHT_LABEL)
        .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;

    #[cfg(target_os = "macos")]
    {
        use crate::platform::macos::ResizeMode;
        let mode = if after_next_presentation_update.unwrap_or(false) {
            ResizeMode::AfterNextPresentationUpdate
        } else if defer_until_next_ca_commit.unwrap_or(false) {
            ResizeMode::DeferToNextCaCommit
        } else {
            ResizeMode::Immediate
        };
        crate::platform::macos::set_launcher_window_height(&window, height, mode);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = defer_until_next_ca_commit;
        let _ = after_next_presentation_update;
        use tauri::LogicalSize;
        let size = window
            .inner_size()
            .map_err(|e| AppError::Platform(e.to_string()))?;
        let scale = window.scale_factor().unwrap_or(1.0);
        let logical_width = size.width as f64 / scale;
        let _ = window.set_size(tauri::Size::Logical(LogicalSize {
            width: logical_width,
            height,
        }));
    }

    Ok(())
}

/// Updates the NSVisualEffectView material on the launcher panel to match the
/// given theme preference. On non-macOS this is a no-op — the command still
/// succeeds so the JS caller does not need platform guards.
///
/// Passes the *preference* string (not the resolved value) so Rust can
/// re-resolve `"system"` consistently with the OS-notification observer path.
#[tauri::command]
pub fn set_panel_appearance(app_handle: AppHandle, pref: String) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let theme_pref = crate::parse_theme_preference_str(&pref);
        {
            if let Some(state) = app_handle.try_state::<std::sync::Mutex<crate::ThemePreference>>()
            {
                *state.lock().map_err(|_| AppError::Lock)? = theme_pref;
            }
        }
        let handle_clone = app_handle.clone();
        let _ = app_handle.run_on_main_thread(move || {
            if let Some(window) = handle_clone.get_webview_window(crate::SPOTLIGHT_LABEL) {
                crate::platform::macos::apply_panel_appearance(&window, theme_pref);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app_handle, pref);
    }
    Ok(())
}

/// Shows the launcher panel using the same logic as the global-hotkey handler.
///
/// Intended for use from non-command code (e.g., `onboarding::window`) that
/// holds an `&AppHandle` but not a `State<'_, AppState>`. Accesses managed
/// state via `app.state::<AppState>()`.
pub fn show_launcher(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    state.asyar_visible.store(true, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        let panel = app
            .get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|_| AppError::NotFound("launcher panel".to_string()))?;
        let window = app
            .get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher panel window".to_string()))?;
        crate::platform::macos::reveal_launcher_panel(&window, &panel);
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Intentionally omits capture_previous_foreground: the caller is
        // the onboarding completion flow, where the previously-focused
        // window is Asyar's own onboarding window. Recording it would
        // corrupt the snippet/paste target on the first launch.
        let window = app
            .get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        crate::launcher_placement::service::apply(app)?;
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

/// Cleanly exits the application.
#[tauri::command]
pub fn quit_app(app_handle: AppHandle) {
    app_handle.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_nan() {
        assert!(validate_launcher_height(f64::NAN).is_err());
    }

    #[test]
    fn rejects_positive_infinity() {
        assert!(validate_launcher_height(f64::INFINITY).is_err());
    }

    #[test]
    fn rejects_negative_infinity() {
        assert!(validate_launcher_height(f64::NEG_INFINITY).is_err());
    }

    #[test]
    fn rejects_zero() {
        assert!(validate_launcher_height(0.0).is_err());
    }

    #[test]
    fn rejects_negative() {
        assert!(validate_launcher_height(-10.0).is_err());
    }

    #[test]
    fn rejects_below_minimum() {
        assert!(validate_launcher_height(49.9).is_err());
    }

    #[test]
    fn rejects_above_maximum() {
        assert!(validate_launcher_height(2000.1).is_err());
    }

    #[test]
    fn accepts_compact_height() {
        assert!(validate_launcher_height(96.0).is_ok());
    }

    #[test]
    fn accepts_default_height() {
        assert!(validate_launcher_height(480.0).is_ok());
    }

    #[test]
    fn accepts_minimum_boundary() {
        assert!(validate_launcher_height(50.0).is_ok());
    }

    #[test]
    fn accepts_maximum_boundary() {
        assert!(validate_launcher_height(2000.0).is_ok());
    }

    #[test]
    fn error_is_validation_variant() {
        let err = validate_launcher_height(f64::NAN).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
