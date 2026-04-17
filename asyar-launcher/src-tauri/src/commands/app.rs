//! Window visibility and focus-lock commands.
//!
//! Controls showing, hiding, and focus-locking the launcher window.

use crate::{AppState, SPOTLIGHT_LABEL};
use crate::error::AppError;
use std::sync::atomic::Ordering;
use tauri::AppHandle;
#[allow(unused_imports)]
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;

/// Makes the launcher window visible and brings it to focus.
#[tauri::command]
pub fn show(app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    state.asyar_visible.store(true, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|_| AppError::NotFound("launcher panel".to_string()))?;
        panel.show();
    }
    #[cfg(not(target_os = "macos"))]
    {
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
        let window = app_handle.get_webview_window(SPOTLIGHT_LABEL)
            .ok_or_else(|| AppError::NotFound("launcher window".to_string()))?;
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
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

/// Locks or unlocks keyboard focus to prevent the window from losing focus.
#[tauri::command]
pub fn set_focus_lock(state: tauri::State<'_, AppState>, locked: bool) {
    state.focus_locked.store(locked, Ordering::Relaxed);
}

/// Mirrors the launcher's "has a non-empty query" state into Rust so the
/// panel resign handler can decide whether to collapse compact geometry on
/// hide without racing JS.
#[tauri::command]
pub fn set_launcher_has_query(state: tauri::State<'_, AppState>, has_query: bool) {
    state.launcher_has_query.store(has_query, Ordering::Relaxed);
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
