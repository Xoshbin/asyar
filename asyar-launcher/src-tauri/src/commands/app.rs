//! Window visibility and focus-lock commands.
//!
//! `show`/`hide` are single-shot; `prepare_show` + `commit_show` is the
//! flash-free reveal path documented on those functions.

use crate::{AppState, SPOTLIGHT_LABEL};
use crate::error::AppError;
use std::sync::atomic::Ordering;
use tauri::AppHandle;
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;
#[cfg(not(target_os = "macos"))]
use tauri::{LogicalPosition, Position};

/// Off-screen coordinate used on Windows/Linux to make the window invisible
/// while keeping it mapped, so the webview's render process stays in its
/// "visible" activity state and keeps pushing frames.
#[cfg(not(target_os = "macos"))]
const OFFSCREEN_COORD: f64 = -30_000.0;

/// Phase 1 of the flash-free reveal: make the launcher imperceptible but
/// mapped, so the webview resumes rendering without the user seeing the
/// stale cached frame. The JS caller awaits two rAFs after this returns
/// before calling `commit_show`.
#[tauri::command]
pub fn prepare_show(app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    // Intentionally NOT setting asyar_visible here: the panel is mapped but
    // imperceptible until commit_show runs. A concurrent caller reading
    // is_visible during this window must still take the two-phase path,
    // not the single-shot `show` that would composite at alpha 1 mid-prepare.
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|_| AppError::NotFound("launcher panel".to_string()))?;
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        // Alpha 0 first so the order-in composites nothing visible. panel.show()
        // then makes it visible to the window server; WebKit observes the
        // activity-state change and resumes layer-tree commits.
        crate::platform::macos::set_window_alpha(&window, 0.0);
        panel.show();
    }
    #[cfg(not(target_os = "macos"))]
    {
        capture_previous_foreground(&state)?;
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        // Move off-screen before showing: the window stays in the compositor's
        // visible set (so WebView2/WebKitGTK keep pushing frames) but the user
        // can't see it. commit_show restores the final position.
        let _ = window.set_position(Position::Logical(LogicalPosition {
            x: OFFSCREEN_COORD,
            y: OFFSCREEN_COORD,
        }));
        let _ = window.show();
    }
    let _ = state;
    Ok(())
}

/// Phase 2 of the flash-free reveal: position the launcher correctly and
/// reveal it. By the time the JS caller invokes this (after two rAFs) the
/// webview has already committed at least one fresh frame while imperceptible,
/// so the user sees the target UI immediately.
#[tauri::command]
pub fn commit_show(app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        crate::platform::macos::center_at_cursor_monitor(&window)
            .map_err(|e| AppError::Platform(format!("center_at_cursor_monitor: {e}")))?;
        crate::platform::macos::set_window_alpha(&window, 1.0);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        center_on_primary_monitor(&window)?;
        let _ = window.set_focus();
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
        let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|_| AppError::NotFound("launcher panel".to_string()))?;
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher panel window".to_string()))?;
        crate::platform::macos::set_window_alpha(&window, 1.0);
        crate::platform::macos::center_at_cursor_monitor(&window)
            .map_err(|e| AppError::Platform(format!("center_at_cursor_monitor: {e}")))?;
        panel.show();
        // Hotkey-initiated extension swaps call `show` while the panel is
        // already visible; `panel.show()` then doesn't touch the first
        // responder, so AppKit can leave the WKWebView off the responder
        // chain and typed keys never reach the DOM. Reseat it explicitly.
        crate::platform::macos::reseat_first_responder(&window);
    }
    #[cfg(not(target_os = "macos"))]
    {
        capture_previous_foreground(&state)?;
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        center_on_primary_monitor(&window)?;
        let _ = window.show();
        let _ = window.set_focus();
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

/// Hides the launcher window.
#[tauri::command]
pub fn hide(app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    state.asyar_visible.store(false, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|_| AppError::NotFound("launcher panel".to_string()))?;
        if panel.is_visible() {
            panel.order_out(None);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
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
        let mut prev = state.linux_prev_window_id.lock().map_err(|_| AppError::Lock)?;
        *prev = wid;
    }
    let _ = state;
    Ok(())
}

/// Pure arithmetic for the centered-with-top-weight launcher position.
/// Horizontally centered in the monitor; vertically placed at 16% from the
/// top edge (matches the macOS cursor-monitor path's top-weight).
#[cfg(any(not(target_os = "macos"), test))]
fn compute_centered_position(
    monitor_pos: (f64, f64),
    monitor_size: (f64, f64),
    window_size: (f64, f64),
) -> (f64, f64) {
    let x = monitor_pos.0 + (monitor_size.0 - window_size.0) / 2.0;
    let y = monitor_pos.1 + monitor_size.1 * 0.16;
    (x, y)
}

/// Cross-platform "center on primary monitor" for the reveal path.
/// macOS uses its own cursor-monitor centering; Windows/Linux fall back to
/// primary monitor since cursor-monitor lookup is platform-dependent and
/// not currently wired up outside macOS.
#[cfg(not(target_os = "macos"))]
fn center_on_primary_monitor<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), AppError> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| AppError::Platform(format!("primary_monitor: {e}")))?
        .ok_or_else(|| AppError::NotFound("primary monitor".to_string()))?;
    let scale = monitor.scale_factor();
    let monitor_size = monitor.size().to_logical::<f64>(scale);
    let monitor_position = monitor.position().to_logical::<f64>(scale);
    let window_size = window
        .outer_size()
        .map_err(|e| AppError::Platform(format!("outer_size: {e}")))?
        .to_logical::<f64>(scale);

    let (x, y) = compute_centered_position(
        (monitor_position.x, monitor_position.y),
        (monitor_size.width, monitor_size.height),
        (window_size.width, window_size.height),
    );

    window
        .set_position(Position::Logical(LogicalPosition { x, y }))
        .map_err(|e| AppError::Platform(format!("set_position: {e}")))?;
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
    state.launcher_keep_expanded.store(keep_expanded, Ordering::Relaxed);
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
/// `expanded: Some(bool)` also toggles the native Show More bar in the same
/// CATransaction as the window resize; `None` leaves its visibility alone.
#[tauri::command]
pub fn set_launcher_height(
    app_handle: AppHandle,
    height: f64,
    expanded: Option<bool>,
) -> Result<(), AppError> {
    validate_launcher_height(height)?;
    let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
        .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;

    #[cfg(target_os = "macos")]
    crate::platform::macos::set_launcher_window_height(&window, height, expanded);

    #[cfg(not(target_os = "macos"))]
    {
        let _ = expanded;
        use tauri::LogicalSize;
        let size = window.inner_size().map_err(|e| AppError::Platform(e.to_string()))?;
        let scale = window.scale_factor().unwrap_or(1.0);
        let logical_width = size.width as f64 / scale;
        let _ = window.set_size(tauri::Size::Logical(LogicalSize {
            width: logical_width,
            height,
        }));
    }

    Ok(())
}

/// Reveals the native Show More bar, which was created hidden so cold-start
/// paint latency doesn't show a bar above a blank search header. The frontend
/// fires this from a single onMount rAF so `setHidden:NO` lands on the same
/// CATransaction as WebKit's first painted frame. No-op on non-macOS.
#[tauri::command]
pub fn mark_launcher_ready(expanded: bool) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::reveal_show_more_bar(expanded);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = expanded;
    }
    Ok(())
}

/// Color palette for the native macOS Show More bar. Each field is a CSS
/// color string (`#RRGGBB`/`#RRGGBBAA`, `rgb(r,g,b)`, `rgba(r,g,b,a)`).
#[derive(serde::Deserialize, Debug)]
pub struct ShowMoreBarStyle {
    pub bar_bg: String,
    pub border: String,
    pub text: String,
    pub chip_bg: String,
    pub chip_border: String,
}

/// Updates the native Show More bar's colors to match the current webview
/// theme. No-op on non-macOS.
#[tauri::command]
pub fn update_show_more_bar_style(style: ShowMoreBarStyle) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let bar_bg = parse_css_color(&style.bar_bg)?;
        let border = parse_css_color(&style.border)?;
        let text = parse_css_color(&style.text)?;
        let chip_bg = parse_css_color(&style.chip_bg)?;
        let chip_border = parse_css_color(&style.chip_border)?;
        crate::platform::macos::apply_show_more_bar_style(bar_bg, border, text, chip_bg, chip_border);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = style;
    }
    Ok(())
}

/// Parses the `rgb(r, g, b)` / `rgba(r, g, b, a)` / `rgb(r g b / a)` forms
/// that `getComputedStyle` always returns — browsers normalize hex and named
/// colors to these before the JS side reads them.
#[cfg(target_os = "macos")]
fn parse_css_color(s: &str) -> Result<(f64, f64, f64, f64), AppError> {
    let s = s.trim();
    let invalid = || AppError::Validation(format!("unsupported color: {s}"));
    let inner = s
        .strip_prefix("rgba(")
        .or_else(|| s.strip_prefix("rgb("))
        .and_then(|r| r.strip_suffix(')'))
        .ok_or_else(invalid)?;

    let parts: Vec<&str> = inner
        .split(|c: char| c == ',' || c == '/' || c.is_whitespace())
        .filter(|p| !p.is_empty())
        .collect();
    if !(3..=4).contains(&parts.len()) { return Err(invalid()); }

    let chan = |p: &str| -> Result<f64, AppError> {
        let v: u16 = p.parse().map_err(|_| invalid())?;
        if v > 255 { return Err(invalid()); }
        Ok(v as f64 / 255.0)
    };
    let a: f64 = if parts.len() == 4 { parts[3].parse().map_err(|_| invalid())? } else { 1.0 };
    if !(0.0..=1.0).contains(&a) { return Err(invalid()); }
    Ok((chan(parts[0])?, chan(parts[1])?, chan(parts[2])?, a))
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
    fn centers_on_origin_monitor() {
        let (x, y) = compute_centered_position((0.0, 0.0), (1920.0, 1080.0), (560.0, 96.0));
        assert_eq!(x, (1920.0 - 560.0) / 2.0);
        assert_eq!(y, 1080.0 * 0.16);
    }

    #[test]
    fn centers_on_offset_monitor() {
        // Secondary display whose top-left is at (1920, -200) — common
        // multi-monitor layout. Position must include the monitor origin.
        let (x, y) = compute_centered_position((1920.0, -200.0), (2560.0, 1440.0), (560.0, 96.0));
        assert_eq!(x, 1920.0 + (2560.0 - 560.0) / 2.0);
        assert_eq!(y, -200.0 + 1440.0 * 0.16);
    }

    #[test]
    fn handles_window_wider_than_monitor() {
        // Pathological but should not panic; x just goes negative.
        let (x, _) = compute_centered_position((0.0, 0.0), (800.0, 600.0), (1000.0, 96.0));
        assert_eq!(x, (800.0 - 1000.0) / 2.0);
    }

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
        assert!(validate_launcher_height(560.0).is_ok());
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

    #[cfg(target_os = "macos")]
    mod parse_css_color_tests {
        use super::*;

        #[test]
        fn accepts_rgb_comma_form() {
            let (r, g, b, a) = parse_css_color("rgb(255, 0, 128)").unwrap();
            assert_eq!(r, 1.0);
            assert_eq!(g, 0.0);
            assert!((b - 128.0 / 255.0).abs() < 1e-9);
            assert_eq!(a, 1.0);
        }

        #[test]
        fn accepts_rgba_with_alpha() {
            let (r, g, b, a) = parse_css_color("rgba(0, 0, 0, 0.5)").unwrap();
            assert_eq!((r, g, b, a), (0.0, 0.0, 0.0, 0.5));
        }

        #[test]
        fn accepts_css4_space_slash_form() {
            let (r, g, b, a) = parse_css_color("rgb(255 128 64 / 0.75)").unwrap();
            assert_eq!(r, 1.0);
            assert!((g - 128.0 / 255.0).abs() < 1e-9);
            assert!((b - 64.0 / 255.0).abs() < 1e-9);
            assert_eq!(a, 0.75);
        }

        #[test]
        fn accepts_leading_and_trailing_whitespace() {
            assert!(parse_css_color("  rgb(1, 2, 3)  ").is_ok());
        }

        #[test]
        fn accepts_black() {
            let (r, g, b, a) = parse_css_color("rgb(0, 0, 0)").unwrap();
            assert_eq!((r, g, b, a), (0.0, 0.0, 0.0, 1.0));
        }

        #[test]
        fn accepts_white() {
            let (r, g, b, a) = parse_css_color("rgb(255, 255, 255)").unwrap();
            assert_eq!((r, g, b, a), (1.0, 1.0, 1.0, 1.0));
        }

        #[test]
        fn rejects_missing_closing_paren() {
            assert!(parse_css_color("rgb(1, 2, 3").is_err());
        }

        #[test]
        fn rejects_hex_form() {
            assert!(parse_css_color("#ffffff").is_err());
        }

        #[test]
        fn rejects_hsl_form() {
            assert!(parse_css_color("hsl(0, 0%, 0%)").is_err());
        }

        #[test]
        fn rejects_too_few_channels() {
            assert!(parse_css_color("rgb(1, 2)").is_err());
        }

        #[test]
        fn rejects_too_many_channels() {
            assert!(parse_css_color("rgb(1, 2, 3, 4, 5)").is_err());
        }

        #[test]
        fn rejects_channel_above_255() {
            assert!(parse_css_color("rgb(256, 0, 0)").is_err());
        }

        #[test]
        fn rejects_non_numeric_channel() {
            assert!(parse_css_color("rgb(x, 0, 0)").is_err());
        }

        #[test]
        fn rejects_negative_channel() {
            assert!(parse_css_color("rgb(-1, 0, 0)").is_err());
        }

        #[test]
        fn rejects_alpha_above_one() {
            assert!(parse_css_color("rgba(0, 0, 0, 1.5)").is_err());
        }

        #[test]
        fn rejects_negative_alpha() {
            assert!(parse_css_color("rgba(0, 0, 0, -0.1)").is_err());
        }

        #[test]
        fn error_is_validation_variant() {
            let err = parse_css_color("nope").unwrap_err();
            assert!(matches!(err, AppError::Validation(_)));
        }
    }
}
