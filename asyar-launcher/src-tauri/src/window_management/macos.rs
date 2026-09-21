#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::ptr;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2::{msg_send, msg_send_id};
use objc2_foundation::NSString;
use tauri::Manager;

use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;

use crate::error::AppError;
use crate::window_management::types::{AppWindowInfo, WindowBounds, WindowBoundsUpdate};

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}
#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}

const K_AX_VALUE_CG_POINT: u32 = 1;
const K_AX_VALUE_CG_SIZE: u32 = 2;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(
        option: u32,
        relative_to_window: u32,
    ) -> core_foundation::array::CFArrayRef;
}

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
    fn AXUIElementPerformAction(element: *mut c_void, action: *mut c_void) -> i32;
    fn AXValueCreate(the_type: u32, value: *const c_void) -> *mut c_void;
    fn AXValueGetValue(value: *mut c_void, the_type: u32, value_ptr: *mut c_void) -> bool;
    fn _AXUIElementGetWindow(element: *mut c_void, wid: *mut u32) -> i32;
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
        return Err(AppError::Platform(
            "AXUIElementCreateApplication returned null".to_string(),
        ));
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
             Enable it in System Settings > Privacy & Security > Accessibility."
                .to_string(),
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
        AXValueGetValue(
            pos_ref,
            K_AX_VALUE_CG_POINT,
            &mut point as *mut _ as *mut c_void,
        );
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
        let mut size = CGSize {
            width: 0.0,
            height: 0.0,
        };
        AXValueGetValue(
            size_ref,
            K_AX_VALUE_CG_SIZE,
            &mut size as *mut _ as *mut c_void,
        );
        CFRelease(size_ref);
        CFRelease(window_ref);

        Ok(WindowBounds {
            x: point.x,
            y: point.y,
            width: size.width,
            height: size.height,
        })
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
        AXValueGetValue(
            pos_ref,
            K_AX_VALUE_CG_POINT,
            &mut current_point as *mut _ as *mut c_void,
        );
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
        let mut current_size = CGSize {
            width: 0.0,
            height: 0.0,
        };
        AXValueGetValue(
            size_ref,
            K_AX_VALUE_CG_SIZE,
            &mut current_size as *mut _ as *mut c_void,
        );
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
                return Err(AppError::Platform(
                    "AXValueCreate(CGPoint) failed".to_string(),
                ));
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
                return Err(AppError::Platform(
                    "AXValueCreate(CGSize) failed".to_string(),
                ));
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
        let value = if enable {
            kCFBooleanTrue
        } else {
            kCFBooleanFalse
        };
        let full_attr = NSString::from_str("AXFullScreen");
        AXUIElementSetAttributeValue(window_ref, Retained::as_ptr(&full_attr) as *mut _, value);
        CFRelease(window_ref);
        Ok(())
    }
}

/// Attempts to retrieve a window's title via the Accessibility API as a fallback.
unsafe fn get_window_title_via_ax(pid: i32, target_wid: u32) -> Option<String> {
    let app_elem = AXUIElementCreateApplication(pid);
    if app_elem.is_null() {
        return None;
    }
    let windows_attr = NSString::from_str("AXWindows");
    let mut windows_ref: *mut c_void = ptr::null_mut();
    let err = AXUIElementCopyAttributeValue(
        app_elem,
        Retained::as_ptr(&windows_attr) as *mut _,
        &mut windows_ref,
    );
    CFRelease(app_elem);
    if err != 0 || windows_ref.is_null() {
        return None;
    }

    let win_array: CFArray<CFType> = CFArray::wrap_under_create_rule(windows_ref as _);
    for i in 0..win_array.len() {
        if let Some(w) = win_array.get(i) {
            let win_elem = w.as_CFTypeRef() as *mut c_void;
            let mut elem_wid: u32 = 0;
            if _AXUIElementGetWindow(win_elem, &mut elem_wid) == 0 && elem_wid == target_wid {
                let title_attr = NSString::from_str("AXTitle");
                let mut title_ref: *mut c_void = ptr::null_mut();
                if AXUIElementCopyAttributeValue(
                    win_elem,
                    Retained::as_ptr(&title_attr) as *mut _,
                    &mut title_ref,
                ) == 0
                    && !title_ref.is_null()
                {
                    let cf_title: CFString = CFString::wrap_under_create_rule(title_ref as _);
                    let title_str = cf_title.to_string();
                    if !title_str.trim().is_empty() {
                        return Some(title_str);
                    }
                }
            }
        }
    }
    None
}

/// Enumerates on-screen and active windows using CoreGraphics and Accessibility.
pub fn list_windows(app: &tauri::AppHandle) -> Result<Vec<AppWindowInfo>, AppError> {
    let icon_cache_dir = app.path().app_data_dir().map(|d| d.join("icon_cache")).ok();
    let our_pid = std::process::id() as i32;

    unsafe {
        // kCGWindowListOptionOnScreenOnly (1) | kCGWindowListExcludeDesktopElements (16)
        let window_list_ref = CGWindowListCopyWindowInfo(1 | 16, 0);
        if window_list_ref.is_null() {
            return Ok(Vec::new());
        }

        let window_list: CFArray<CFType> = CFArray::wrap_under_create_rule(window_list_ref);
        let count = window_list.len();

        let mut results = Vec::new();
        let mut found_focused = false;

        let layer_key = CFString::new("kCGWindowLayer");
        let bounds_key = CFString::new("kCGWindowBounds");
        let name_key = CFString::new("kCGWindowName");
        let owner_name_key = CFString::new("kCGWindowOwnerName");
        let pid_key = CFString::new("kCGWindowOwnerPID");
        let num_key = CFString::new("kCGWindowNumber");
        let is_onscreen_key = CFString::new("kCGWindowIsOnscreen");

        let app_class = AnyClass::get("NSRunningApplication");

        for i in 0..count {
            let item = match window_list.get(i) {
                Some(it) => it,
                None => continue,
            };

            let dict_ref = item.as_CFTypeRef() as core_foundation::dictionary::CFDictionaryRef;
            if dict_ref.is_null() {
                continue;
            }
            let dict: CFDictionary<CFString, CFType> = CFDictionary::wrap_under_get_rule(dict_ref);

            // Layer 0 is normal user application windows
            let layer = dict
                .find(&layer_key)
                .and_then(|v| v.downcast::<CFNumber>())
                .and_then(|n| n.to_i32())
                .unwrap_or(-1);
            if layer != 0 {
                continue;
            }

            // PID check
            let pid = dict
                .find(&pid_key)
                .and_then(|v| v.downcast::<CFNumber>())
                .and_then(|n| n.to_i32())
                .unwrap_or(0);
            if pid <= 0 || pid == our_pid {
                continue;
            }

            // Window ID
            let wid = dict
                .find(&num_key)
                .and_then(|v| v.downcast::<CFNumber>())
                .and_then(|n| n.to_i64())
                .unwrap_or(0) as u32;
            if wid == 0 {
                continue;
            }

            // Check dimensions (must be > 50x50 to avoid invisible/helper windows)
            if let Some(bounds_val) = dict.find(&bounds_key) {
                let bounds_dict_ref =
                    bounds_val.as_CFTypeRef() as core_foundation::dictionary::CFDictionaryRef;
                if !bounds_dict_ref.is_null() {
                    let bdict: CFDictionary<CFString, CFType> =
                        CFDictionary::wrap_under_get_rule(bounds_dict_ref);
                    let w_key = CFString::new("Width");
                    let h_key = CFString::new("Height");
                    let width = bdict
                        .find(&w_key)
                        .and_then(|v| v.downcast::<CFNumber>())
                        .and_then(|n| n.to_f64())
                        .unwrap_or(0.0);
                    let height = bdict
                        .find(&h_key)
                        .and_then(|v| v.downcast::<CFNumber>())
                        .and_then(|n| n.to_f64())
                        .unwrap_or(0.0);
                    if width < 50.0 || height < 50.0 {
                        continue;
                    }
                }
            }

            // Running application metadata
            let running_app: *mut AnyObject = if let Some(cls) = app_class {
                msg_send![cls, runningApplicationWithProcessIdentifier: pid]
            } else {
                ptr::null_mut()
            };

            let mut app_name = String::new();
            let mut app_bundle_id = None;
            let mut app_icon = None;

            if !running_app.is_null() {
                // Filter regular GUI apps (activationPolicy == 0)
                let policy: isize = msg_send![running_app, activationPolicy];
                if policy != 0 {
                    continue;
                }

                let name_obj: Option<Retained<NSString>> = msg_send_id![running_app, localizedName];
                if let Some(n) = name_obj {
                    app_name = n.to_string();
                }

                let bid_obj: Option<Retained<NSString>> =
                    msg_send_id![running_app, bundleIdentifier];
                if let Some(b) = bid_obj {
                    app_bundle_id = Some(b.to_string());
                }

                let url: *mut AnyObject = msg_send![running_app, bundleURL];
                if !url.is_null() {
                    let path_obj: Option<Retained<NSString>> = msg_send_id![url, path];
                    if let Some(p) = path_obj {
                        let path_str = p.to_string();
                        if let Some(ref cache_dir) = icon_cache_dir {
                            app_icon =
                                crate::application::service::extract_app_icon(&path_str, cache_dir);
                        }
                    }
                }
            }

            if app_name.is_empty() {
                app_name = dict
                    .find(&owner_name_key)
                    .and_then(|v| v.downcast::<CFString>())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "Unknown".to_string());
            }

            let mut title = dict
                .find(&name_key)
                .and_then(|v| v.downcast::<CFString>())
                .map(|s| s.to_string())
                .unwrap_or_default();

            if title.trim().is_empty() {
                if let Some(ax_title) = get_window_title_via_ax(pid, wid) {
                    title = ax_title;
                }
            }

            if title.trim().is_empty() {
                continue;
            }

            let is_onscreen = dict
                .find(&is_onscreen_key)
                .and_then(|v| v.downcast::<CFBoolean>())
                .map(bool::from)
                .unwrap_or(true);

            let is_focused = if !found_focused {
                found_focused = true;
                true
            } else {
                false
            };

            results.push(AppWindowInfo {
                id: format!("macos:{pid}:{wid}"),
                pid,
                app_name,
                app_bundle_id,
                title: title.trim().to_string(),
                is_minimized: !is_onscreen,
                is_focused,
                app_icon,
            });
        }

        Ok(results)
    }
}

/// Brings a specific window to the foreground and focuses it.
pub fn focus_window(id: &str) -> Result<(), AppError> {
    check_ax_permission()?;

    let parts: Vec<&str> = id.split(':').collect();
    if parts.len() < 3 || parts[0] != "macos" {
        return Err(AppError::Validation(format!(
            "Invalid macOS window ID: {id}"
        )));
    }
    let pid: i32 = parts[1]
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid pid in window ID: {id}")))?;
    let wid: u32 = parts[2]
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid wid in window ID: {id}")))?;

    unsafe {
        // 1. Activate application
        if let Some(cls) = AnyClass::get("NSRunningApplication") {
            let app: *mut AnyObject = msg_send![cls, runningApplicationWithProcessIdentifier: pid];
            if !app.is_null() {
                // NSApplicationActivateIgnoringOtherApps = 1 << 1 = 2
                let _: bool = msg_send![app, activateWithOptions: 2u64];
            }
        }

        // 2. Locate window element via Accessibility API and focus
        let app_elem = AXUIElementCreateApplication(pid);
        if app_elem.is_null() {
            return Err(AppError::Platform(
                "Failed to create AX element for app".to_string(),
            ));
        }

        let windows_attr = NSString::from_str("AXWindows");
        let mut windows_ref: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(
            app_elem,
            Retained::as_ptr(&windows_attr) as *mut _,
            &mut windows_ref,
        );
        if err != 0 || windows_ref.is_null() {
            CFRelease(app_elem);
            return Err(AppError::Platform(format!("AXWindows unavailable: {err}")));
        }

        let win_array: CFArray<CFType> = CFArray::wrap_under_create_rule(windows_ref as _);
        let mut target_window: *mut c_void = ptr::null_mut();

        for i in 0..win_array.len() {
            if let Some(w) = win_array.get(i) {
                let win_elem = w.as_CFTypeRef() as *mut c_void;
                let mut elem_wid: u32 = 0;
                if _AXUIElementGetWindow(win_elem, &mut elem_wid) == 0 && elem_wid == wid {
                    target_window = win_elem;
                    break;
                }
            }
        }

        // Fallback: if not matched by wid, use first window in array
        if target_window.is_null() && !win_array.is_empty() {
            if let Some(w) = win_array.get(0) {
                target_window = w.as_CFTypeRef() as *mut c_void;
            }
        }

        if !target_window.is_null() {
            // Restore if minimized
            let min_attr = NSString::from_str("AXMinimized");
            AXUIElementSetAttributeValue(
                target_window,
                Retained::as_ptr(&min_attr) as *mut _,
                kCFBooleanFalse,
            );

            // Raise window
            let raise_action = NSString::from_str("AXRaise");
            AXUIElementPerformAction(target_window, Retained::as_ptr(&raise_action) as *mut _);

            // Focus window
            let focus_attr = NSString::from_str("AXFocusedWindow");
            AXUIElementSetAttributeValue(
                app_elem,
                Retained::as_ptr(&focus_attr) as *mut _,
                target_window,
            );
        }

        CFRelease(app_elem);
    }

    Ok(())
}

/// Closes a specific window using the Accessibility API close action.
pub fn close_window(id: &str) -> Result<(), AppError> {
    check_ax_permission()?;

    let parts: Vec<&str> = id.split(':').collect();
    if parts.len() < 3 || parts[0] != "macos" {
        return Err(AppError::Validation(format!(
            "Invalid macOS window ID: {id}"
        )));
    }
    let pid: i32 = parts[1]
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid pid in window ID: {id}")))?;
    let wid: u32 = parts[2]
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid wid in window ID: {id}")))?;

    unsafe {
        let app_elem = AXUIElementCreateApplication(pid);
        if app_elem.is_null() {
            return Err(AppError::Platform(
                "Failed to create AX element for app".to_string(),
            ));
        }

        let windows_attr = NSString::from_str("AXWindows");
        let mut windows_ref: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(
            app_elem,
            Retained::as_ptr(&windows_attr) as *mut _,
            &mut windows_ref,
        );
        if err != 0 || windows_ref.is_null() {
            CFRelease(app_elem);
            return Err(AppError::Platform(format!("AXWindows unavailable: {err}")));
        }

        let win_array: CFArray<CFType> = CFArray::wrap_under_create_rule(windows_ref as _);
        for i in 0..win_array.len() {
            if let Some(w) = win_array.get(i) {
                let win_elem = w.as_CFTypeRef() as *mut c_void;
                let mut elem_wid: u32 = 0;
                if _AXUIElementGetWindow(win_elem, &mut elem_wid) == 0 && elem_wid == wid {
                    let close_attr = NSString::from_str("AXCloseButton");
                    let mut close_btn: *mut c_void = ptr::null_mut();
                    if AXUIElementCopyAttributeValue(
                        win_elem,
                        Retained::as_ptr(&close_attr) as *mut _,
                        &mut close_btn,
                    ) == 0
                        && !close_btn.is_null()
                    {
                        let press_action = NSString::from_str("AXPress");
                        AXUIElementPerformAction(
                            close_btn,
                            Retained::as_ptr(&press_action) as *mut _,
                        );
                        CFRelease(close_btn);
                    }
                    break;
                }
            }
        }
        CFRelease(app_elem);
    }

    Ok(())
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

    #[test]
    fn focus_window_rejects_malformed_id() {
        let err = focus_window("invalid-id").unwrap_err();
        assert!(matches!(
            err,
            AppError::Permission(_) | AppError::Validation(_)
        ));
    }

    #[test]
    fn close_window_rejects_malformed_id() {
        let err = close_window("invalid-id").unwrap_err();
        assert!(matches!(
            err,
            AppError::Permission(_) | AppError::Validation(_)
        ));
    }
}
