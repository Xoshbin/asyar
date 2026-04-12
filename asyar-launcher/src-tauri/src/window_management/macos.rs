#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::ptr;

use objc2::rc::Retained;
use objc2_foundation::NSString;

use crate::error::AppError;
use crate::window_management::types::{WindowBounds, WindowBoundsUpdate};

#[repr(C)]
struct CGPoint { x: f64, y: f64 }
#[repr(C)]
struct CGSize { width: f64, height: f64 }

const K_AX_VALUE_CG_POINT: u32 = 1;
const K_AX_VALUE_CG_SIZE: u32 = 2;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
    fn AXUIElementCopyAttributeValue(
        element: *mut c_void,
        attribute: *mut c_void,
        value: *mut *mut c_void,
    ) -> i32;
    fn AXUIElementSetAttributeValue(
        element: *mut c_void,
        attribute: *mut c_void,
        value: *mut c_void,
    ) -> i32;
    fn AXValueCreate(the_type: u32, value: *const c_void) -> *mut c_void;
    fn AXValueGetValue(value: *mut c_void, the_type: u32, value_ptr: *mut c_void) -> bool;
    fn CFRelease(cf: *mut c_void);
    static kCFBooleanTrue: *mut c_void;
    static kCFBooleanFalse: *mut c_void;
}

/// Gets the AX element for the frontmost app's focused window.
/// Caller must CFRelease the returned pointer.
unsafe fn get_focused_window_element() -> Result<*mut c_void, AppError> {
    let pid = crate::platform::macos::get_frontmost_app_pid()
        .ok_or_else(|| AppError::NotFound("frontmost app pid".to_string()))?;

    let app_element = AXUIElementCreateApplication(pid);
    if app_element.is_null() {
        return Err(AppError::Platform("AXUIElementCreateApplication returned null".to_string()));
    }

    let focused_attr = NSString::from_str("AXFocusedWindow");
    let mut window_ref: *mut c_void = ptr::null_mut();
    let err = AXUIElementCopyAttributeValue(
        app_element,
        Retained::as_ptr(&focused_attr) as *mut _,
        &mut window_ref,
    );
    CFRelease(app_element);

    if err != 0 || window_ref.is_null() {
        return Err(AppError::Platform(format!(
            "AXFocusedWindow unavailable (code {err}). Ensure Accessibility permission is granted."
        )));
    }
    Ok(window_ref)
}

pub fn check_ax_permission() -> Result<(), AppError> {
    if !crate::platform::macos::is_accessibility_trusted() {
        return Err(AppError::Permission(
            "Accessibility permission required for WindowManagementService. \
             Enable it in System Settings > Privacy & Security > Accessibility.".to_string(),
        ));
    }
    Ok(())
}

pub fn get_window_bounds() -> Result<WindowBounds, AppError> {
    check_ax_permission()?;
    unsafe {
        let window_ref = get_focused_window_element()?;

        let pos_attr = NSString::from_str("AXPosition");
        let mut pos_ref: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(
            window_ref,
            Retained::as_ptr(&pos_attr) as *mut _,
            &mut pos_ref,
        );
        if err != 0 || pos_ref.is_null() {
            CFRelease(window_ref);
            return Err(AppError::Platform(format!("AXPosition error: {err}")));
        }
        let mut point = CGPoint { x: 0.0, y: 0.0 };
        AXValueGetValue(pos_ref, K_AX_VALUE_CG_POINT, &mut point as *mut _ as *mut c_void);
        CFRelease(pos_ref);

        let size_attr = NSString::from_str("AXSize");
        let mut size_ref: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(
            window_ref,
            Retained::as_ptr(&size_attr) as *mut _,
            &mut size_ref,
        );
        if err != 0 || size_ref.is_null() {
            CFRelease(window_ref);
            return Err(AppError::Platform(format!("AXSize error: {err}")));
        }
        let mut size = CGSize { width: 0.0, height: 0.0 };
        AXValueGetValue(size_ref, K_AX_VALUE_CG_SIZE, &mut size as *mut _ as *mut c_void);
        CFRelease(size_ref);
        CFRelease(window_ref);

        Ok(WindowBounds { x: point.x, y: point.y, width: size.width, height: size.height })
    }
}

pub fn set_window_bounds(update: &WindowBoundsUpdate) -> Result<(), AppError> {
    check_ax_permission()?;
    unsafe {
        // Acquire window element once — all reads and writes use this same ref.
        let window_ref = get_focused_window_element()?;

        // Read current position
        let pos_attr = NSString::from_str("AXPosition");
        let mut pos_ref: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(
            window_ref,
            Retained::as_ptr(&pos_attr) as *mut _,
            &mut pos_ref,
        );
        if err != 0 || pos_ref.is_null() {
            CFRelease(window_ref);
            return Err(AppError::Platform(format!("AXPosition read error: {err}")));
        }
        let mut current_point = CGPoint { x: 0.0, y: 0.0 };
        AXValueGetValue(pos_ref, K_AX_VALUE_CG_POINT, &mut current_point as *mut _ as *mut c_void);
        CFRelease(pos_ref);

        // Read current size
        let size_attr = NSString::from_str("AXSize");
        let mut size_ref: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(
            window_ref,
            Retained::as_ptr(&size_attr) as *mut _,
            &mut size_ref,
        );
        if err != 0 || size_ref.is_null() {
            CFRelease(window_ref);
            return Err(AppError::Platform(format!("AXSize read error: {err}")));
        }
        let mut current_size = CGSize { width: 0.0, height: 0.0 };
        AXValueGetValue(size_ref, K_AX_VALUE_CG_SIZE, &mut current_size as *mut _ as *mut c_void);
        CFRelease(size_ref);

        // Write position if x or y was specified
        if update.x.is_some() || update.y.is_some() {
            let point = CGPoint {
                x: update.x.unwrap_or(current_point.x),
                y: update.y.unwrap_or(current_point.y),
            };
            let ax_pos = AXValueCreate(K_AX_VALUE_CG_POINT, &point as *const _ as *const c_void);
            if ax_pos.is_null() {
                CFRelease(window_ref);
                return Err(AppError::Platform("AXValueCreate(CGPoint) failed".to_string()));
            }
            let write_pos_attr = NSString::from_str("AXPosition");
            AXUIElementSetAttributeValue(
                window_ref,
                Retained::as_ptr(&write_pos_attr) as *mut _,
                ax_pos,
            );
            CFRelease(ax_pos);
        }

        // Write size if width or height was specified
        if update.width.is_some() || update.height.is_some() {
            let cgsize = CGSize {
                width: update.width.unwrap_or(current_size.width),
                height: update.height.unwrap_or(current_size.height),
            };
            let ax_size = AXValueCreate(K_AX_VALUE_CG_SIZE, &cgsize as *const _ as *const c_void);
            if ax_size.is_null() {
                CFRelease(window_ref);
                return Err(AppError::Platform("AXValueCreate(CGSize) failed".to_string()));
            }
            let write_size_attr = NSString::from_str("AXSize");
            AXUIElementSetAttributeValue(
                window_ref,
                Retained::as_ptr(&write_size_attr) as *mut _,
                ax_size,
            );
            CFRelease(ax_size);
        }

        CFRelease(window_ref);
        Ok(())
    }
}

pub fn set_window_fullscreen(enable: bool) -> Result<(), AppError> {
    check_ax_permission()?;
    unsafe {
        let window_ref = get_focused_window_element()?;
        let value = if enable { kCFBooleanTrue } else { kCFBooleanFalse };
        let full_attr = NSString::from_str("AXFullScreen");
        AXUIElementSetAttributeValue(
            window_ref,
            Retained::as_ptr(&full_attr) as *mut _,
            value,
        );
        CFRelease(window_ref);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_ax_permission_returns_permission_error_type() {
        // If accessibility is not trusted, the error variant is Permission.
        // If it IS trusted, the function succeeds — both are valid.
        let result = check_ax_permission();
        match result {
            Ok(()) => {}
            Err(AppError::Permission(_)) => {}
            Err(other) => panic!("Unexpected error type: {:?}", other),
        }
    }
}
