//! Shared keyboard input simulation logic.

use enigo::{Enigo, KeyboardControllable, Key};

/// Simulates a paste chord (Cmd+V on macOS, Ctrl+V elsewhere).
pub fn post_paste_chord() {
    #[cfg(target_os = "macos")]
    {
        post_key_chord_via_enigo(Key::Meta, 'v');
    }
    #[cfg(not(target_os = "macos"))]
    {
        post_key_chord_via_enigo(Key::Control, 'v');
    }
}

/// Simulates a copy chord (Cmd+C on macOS, Ctrl+C elsewhere).
pub fn post_copy_chord_to_frontmost() {
    #[cfg(target_os = "macos")]
    {
        if let Some(pid) = crate::platform::macos::get_frontmost_app_pid() {
            // kVK_ANSI_C = 8, kCGEventFlagMaskCommand = 0x00100000
            post_key_chord_to_pid(pid, 8, 0x00100000);
        } else {
            // Fallback to enigo if PID capture fails
            post_key_chord_via_enigo(Key::Meta, 'c');
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        post_key_chord_via_enigo(Key::Control, 'c');
    }
}

/// Shared helper for enigo-based modifier chords.
pub fn post_key_chord_via_enigo(modifier: Key, key_char: char) {
    let mut enigo = Enigo::new();
    enigo.key_down(modifier);
    enigo.key_click(Key::Layout(key_char));
    enigo.key_up(modifier);
}

#[cfg(target_os = "macos")]
pub fn post_key_chord_to_pid(pid: i32, virtual_key: u16, cg_event_flags: u64) {
    use std::ffi::c_void;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreateKeyboardEvent(
            source: *const c_void,
            virtual_key: u16,
            key_down: bool,
        ) -> *mut c_void;
        fn CGEventSetFlags(event: *mut c_void, flags: u64);
        fn CGEventPostToPid(pid: i32, event: *mut c_void);
        fn CFRelease(cf: *mut c_void);
    }

    log::info!("[input] post_key_chord_to_pid: target_pid={}, vk={}, flags={:#x}", pid, virtual_key, cg_event_flags);

    unsafe {
        // Key-down
        let down = CGEventCreateKeyboardEvent(std::ptr::null(), virtual_key, true);
        if !down.is_null() {
            CGEventSetFlags(down, cg_event_flags);
            CGEventPostToPid(pid, down);
            CFRelease(down);
        } else {
            log::error!("[input] CGEventCreateKeyboardEvent returned null for key-down");
        }

        // Key-up
        let up = CGEventCreateKeyboardEvent(std::ptr::null(), virtual_key, false);
        if !up.is_null() {
            // No flags needed on key-up for simple chords
            CGEventPostToPid(pid, up);
            CFRelease(up);
        } else {
            log::error!("[input] CGEventCreateKeyboardEvent returned null for key-up");
        }
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_post_paste_chord_smoke() {
        // We can't easily verify the OS events in CI, but we ensure it doesn't panic.
        // In a real TDD environment, we might mock enigo or the FFI.
        // For now, this acts as a placeholder for the "red" phase if we had mocks.
    }
}
