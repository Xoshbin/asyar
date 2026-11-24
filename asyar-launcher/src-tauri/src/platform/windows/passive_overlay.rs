//! Native presentation for non-interactive overlays.
//!
//! Tao 0.37's show and style-update paths call ShowWindow(SW_SHOW), even for
//! focusable:false windows. That activates the overlay and blurs the launcher.
//! Keep geometry, click-through and visibility together here: mixing native
//! show with Tao hide would leave Tao's cached visibility out of sync.

use crate::error::AppError;
use tauri::{LogicalPosition, LogicalSize, Runtime, WebviewWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
    SWP_FRAMECHANGED, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SWP_SHOWWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
};

/// Position and reveal a click-through overlay without changing activation.
pub(crate) fn show<R: Runtime>(
    window: &WebviewWindow<R>,
    origin: (f64, f64),
    size: (f64, f64),
) -> Result<(), AppError> {
    let hwnd = window
        .hwnd()
        .map_err(|e| AppError::Platform(format!("overlay handle: {e}")))?;
    let scale = window
        .scale_factor()
        .map_err(|e| AppError::Platform(format!("overlay scale: {e}")))?;
    let pos = LogicalPosition::new(origin.0, origin.1).to_physical::<i32>(scale);
    let size = LogicalSize::new(size.0, size.1).to_physical::<i32>(scale);

    // SAFETY: hwnd belongs to the live, borrowed Tauri window. The native
    // operations take no borrowed pointers and preserve its existing styles.
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            style | (WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE).0 as isize,
        );
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            pos.x,
            pos.y,
            size.width,
            size.height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
        )
    }
    .map_err(|e| AppError::Platform(format!("show overlay without activation: {e}")))
}

/// Pair the native show with a native hide, leaving foreground focus alone.
pub(crate) fn hide<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), AppError> {
    let hwnd = window
        .hwnd()
        .map_err(|e| AppError::Platform(format!("overlay handle: {e}")))?;
    // SAFETY: hwnd belongs to the live, borrowed Tauri window. Geometry and
    // z-order are ignored; only visibility changes, without activation.
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_HIDEWINDOW | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
    }
    .map_err(|e| AppError::Platform(format!("hide overlay without activation: {e}")))
}
