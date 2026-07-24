#![allow(deprecated)]
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, msg_send_id};
use objc2_foundation::NSString;
use std::path::Path;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}
pub fn is_accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}
pub fn open_accessibility_prefs() {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
}

pub fn get_frontmost_app_pid() -> Option<i32> {
    unsafe {
        let workspace_class = AnyClass::get("NSWorkspace")?;
        let workspace: *mut AnyObject = msg_send![workspace_class, sharedWorkspace];
        if workspace.is_null() {
            log::warn!("[paste] get_frontmost_app_pid: sharedWorkspace returned null");
            return None;
        }
        let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            log::warn!("[paste] get_frontmost_app_pid: frontmostApplication returned null");
            return None;
        }
        let pid: i32 = msg_send![app, processIdentifier];
        log::info!("[paste] get_frontmost_app_pid: raw_pid={}", pid);
        if pid > 0 {
            Some(pid)
        } else {
            log::warn!("[paste] get_frontmost_app_pid: invalid pid={}", pid);
            None
        }
    }
}

pub fn get_frontmost_application_metadata() -> Option<(String, String, String, String)> {
    unsafe {
        let workspace_class = AnyClass::get("NSWorkspace")?;
        let workspace: *mut AnyObject = msg_send![workspace_class, sharedWorkspace];
        if workspace.is_null() {
            return None;
        }
        let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }

        let bid_obj: Option<Retained<NSString>> = msg_send_id![app, bundleIdentifier];
        let bid = bid_obj
            .map(|s: Retained<NSString>| s.to_string())
            .unwrap_or_default();

        let url: *mut AnyObject = msg_send![app, bundleURL];
        let path = if !url.is_null() {
            let path_obj: Option<Retained<NSString>> = msg_send_id![url, path];
            path_obj
                .map(|s: Retained<NSString>| s.to_string())
                .unwrap_or_default()
        } else {
            String::new()
        };

        let name_obj: Option<Retained<NSString>> = msg_send_id![app, localizedName];
        let name = name_obj
            .map(|s: Retained<NSString>| s.to_string())
            .unwrap_or_else(|| {
                Path::new(&path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string()
            });

        let title = get_focused_window_title().unwrap_or_default();
        Some((name, bid, path, title))
    }
}

fn get_focused_window_title() -> Option<String> {
    use std::ffi::{c_void, CStr};
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: *mut c_void,
            value: *mut *mut c_void,
        ) -> i32;
        fn CFRelease(cf: *mut c_void);
        fn CFStringGetCStringPtr(s: *mut c_void, encoding: u32) -> *const i8;
        fn CFStringGetLength(s: *mut c_void) -> isize;
        fn CFStringGetCString(s: *mut c_void, buf: *mut i8, buf_size: isize, encoding: u32)
            -> bool;
    }
    const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;
    unsafe {
        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() {
            return None;
        }
        let focused_attr_ns = NSString::from_str("AXFocusedUIElement");
        let mut focused: *mut c_void = std::ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(
            system_wide,
            Retained::as_ptr(&focused_attr_ns) as *mut _,
            &mut focused,
        );
        CFRelease(system_wide);
        if err != 0 || focused.is_null() {
            return None;
        }
        let title_attr_ns = NSString::from_str("AXTitle");
        let mut title_val: *mut c_void = std::ptr::null_mut();
        let err2 = AXUIElementCopyAttributeValue(
            focused,
            Retained::as_ptr(&title_attr_ns) as *mut _,
            &mut title_val,
        );
        CFRelease(focused);
        if err2 != 0 || title_val.is_null() {
            return None;
        }
        let result = if !title_val.is_null() {
            let ptr = CFStringGetCStringPtr(title_val, K_CF_STRING_ENCODING_UTF8);
            if !ptr.is_null() {
                Some(CStr::from_ptr(ptr).to_string_lossy().into_owned())
            } else {
                let len = CFStringGetLength(title_val);
                if len > 0 {
                    let mut buf = vec![0u8; (len * 4 + 1) as usize];
                    if CFStringGetCString(
                        title_val,
                        buf.as_mut_ptr() as *mut i8,
                        buf.len() as isize,
                        K_CF_STRING_ENCODING_UTF8,
                    ) {
                        Some(
                            CStr::from_ptr(buf.as_ptr() as *const i8)
                                .to_string_lossy()
                                .into_owned(),
                        )
                    } else {
                        None
                    }
                } else {
                    Some(String::new())
                }
            }
        } else {
            None
        };
        CFRelease(title_val);
        result
    }
}

/// Number of running application instances with the given bundle id.
///
/// SAFETY: `+[NSRunningApplication runningApplicationsWithBundleIdentifier:]`
/// is thread-safe and only reads process metadata. We never deref returned
/// objects beyond `count`, and `NSString::from_str` owns its buffer.
fn running_app_count(bundle_id: &str) -> usize {
    unsafe {
        let Some(cls) = AnyClass::get("NSRunningApplication") else {
            return 0;
        };
        let bid = NSString::from_str(bundle_id);
        let apps: *mut AnyObject = msg_send![cls, runningApplicationsWithBundleIdentifier: &*bid];
        if apps.is_null() {
            return 0;
        }
        msg_send![apps, count]
    }
}

/// True when at least one running app has the given bundle id. Used to decide
/// whether activation is safe — we only ever bring already-running browsers
/// forward, never launch one.
pub fn is_app_running(bundle_id: &str) -> bool {
    running_app_count(bundle_id) > 0
}

/// Bring an already-running app (by bundle id) to the foreground. Returns
/// `false` (a no-op) when no instance is running — it never launches the app.
///
/// SAFETY: AppKit object messaging via the Objective-C runtime. The returned
/// array and its elements are autoreleased and only messaged synchronously
/// here; `activateWithOptions:` is safe to call from any thread.
pub fn activate_running_app(bundle_id: &str) -> bool {
    unsafe {
        let Some(cls) = AnyClass::get("NSRunningApplication") else {
            return false;
        };
        let bid = NSString::from_str(bundle_id);
        let apps: *mut AnyObject = msg_send![cls, runningApplicationsWithBundleIdentifier: &*bid];
        if apps.is_null() {
            return false;
        }
        let count: usize = msg_send![apps, count];
        if count == 0 {
            return false;
        }
        let app: *mut AnyObject = msg_send![apps, objectAtIndex: 0usize];
        if app.is_null() {
            return false;
        }
        // NSApplicationActivateAllWindows (1<<0) | ActivateIgnoringOtherApps
        // (1<<1) — bring every window of the browser forward, overriding the
        // still-frontmost launcher panel.
        const OPTS: u64 = (1 << 0) | (1 << 1);
        let _: Bool = msg_send![app, activateWithOptions: OPTS];
        true
    }
}
