#![allow(deprecated)]
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, msg_send_id};
use objc2_foundation::NSString;
use std::sync::Arc;

/// Disables macOS's "hold key for accented characters" popup for the
/// process's own bundle.
pub fn disable_press_and_hold() {
    unsafe {
        let defaults_cls = match AnyClass::get("NSUserDefaults") {
            Some(c) => c,
            None => {
                log::warn!("[disable_press_and_hold] NSUserDefaults class not found");
                return;
            }
        };
        let defaults: *mut AnyObject = msg_send![defaults_cls, standardUserDefaults];
        if defaults.is_null() {
            log::warn!("[disable_press_and_hold] standardUserDefaults returned null");
            return;
        }
        let key = NSString::from_str("ApplePressAndHoldEnabled");
        let _: () = msg_send![defaults, setBool: Bool::NO forKey: Retained::as_ptr(&key)];
    }
}

/// Registers a local event monitor for CMD+Q.
/// If `on_cmd_q` returns `true`, CMD+Q was consumed by a focused panel/window
/// and should not quit the application.
pub fn register_cmdq_monitor<F: Fn() -> bool + Clone + 'static>(on_cmd_q: F) {
    use block2::StackBlock;
    const KEY_DOWN_MASK: u64 = 1u64 << 10;
    const VK_Q: u16 = 12;
    const CMD_FLAG: u64 = 1 << 20;

    let handler = StackBlock::new(move |event: *mut AnyObject| -> *mut AnyObject {
        let keycode: u16 = unsafe { msg_send![event, keyCode] };
        let flags: u64 = unsafe { msg_send![event, modifierFlags] };
        if keycode == VK_Q && (flags & CMD_FLAG) != 0 && on_cmd_q() {
            return std::ptr::null_mut();
        }
        event
    });
    let ns_event_cls = AnyClass::get("NSEvent").expect("NSEvent class not found");
    let monitor: Option<Retained<AnyObject>> = unsafe {
        msg_send_id![ns_event_cls, addLocalMonitorForEventsMatchingMask: KEY_DOWN_MASK, handler: &handler]
    };
    if let Some(m) = monitor {
        Box::leak(Box::new(m));
    } else {
        log::error!("CMD+Q local event monitor registration failed");
    }
}

/// Registers the macOS global keyboard monitor for snippet expansion.
pub fn register_snippet_monitor(
    is_active: Arc<dyn Fn() -> bool + Send + Sync + 'static>,
    on_char: Arc<dyn Fn(char) + Send + Sync + 'static>,
    on_reset: Arc<dyn Fn() + Send + Sync + 'static>,
    on_backspace: Arc<dyn Fn() + Send + Sync + 'static>,
) {
    use block2::StackBlock;

    const KEY_DOWN_MASK: u64 = 1u64 << 10;

    let handler = StackBlock::new(move |event: *mut AnyObject| {
        if !is_active() {
            on_reset();
            return;
        }

        let keycode: u16 = unsafe { msg_send![event, keyCode] };
        match keycode {
            53 | 36 | 52 | 48 | 123..=126 => {
                // Escape, Return, Enter, Tab, Arrow keys
                on_reset();
                return;
            }
            51 | 117 => {
                // Delete / Forward Delete
                on_backspace();
                return;
            }
            _ => {}
        }

        let chars_obj: Option<Retained<AnyObject>> =
            unsafe { msg_send_id![event, charactersIgnoringModifiers] };

        if let Some(chars) = chars_obj {
            let utf8: *const i8 = unsafe { msg_send![&*chars, UTF8String] };
            if utf8.is_null() {
                return;
            }
            let s = unsafe {
                std::ffi::CStr::from_ptr(utf8)
                    .to_str()
                    .unwrap_or("")
                    .to_string()
            };

            for c in s.chars() {
                if c.is_control() {
                    continue;
                }
                for lc in c.to_lowercase() {
                    on_char(lc);
                }
            }
        }
    });

    let ns_event_cls = AnyClass::get("NSEvent").expect("NSEvent class not found");
    let monitor: Option<Retained<AnyObject>> = unsafe {
        msg_send_id![
            ns_event_cls,
            addGlobalMonitorForEventsMatchingMask: KEY_DOWN_MASK,
            handler: &handler
        ]
    };

    if let Some(m) = monitor {
        Box::leak(Box::new(m));
    } else {
        log::error!("[snippets] NSEvent monitor registration failed");
    }
}
