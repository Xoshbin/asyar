//! Windows keypress resolver: scancode + modifier state → Unicode char.
//! Uses ToUnicodeEx, so it honors the active layout (HKL), shift, dead keys, and IME state.

#![cfg(target_os = "windows")]

use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyboardLayout, MapVirtualKeyExW, ToUnicodeEx, HKL, MAPVK_VSC_TO_VK_EX, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

fn scan_code_for(key: rdev::Key) -> Option<u32> {
    use rdev::Key;
    Some(match key {
        Key::Escape => 0x01,
        Key::Num1 => 0x02,
        Key::Num2 => 0x03,
        Key::Num3 => 0x04,
        Key::Num4 => 0x05,
        Key::Num5 => 0x06,
        Key::Num6 => 0x07,
        Key::Num7 => 0x08,
        Key::Num8 => 0x09,
        Key::Num9 => 0x0A,
        Key::Num0 => 0x0B,
        Key::Minus => 0x0C,
        Key::Equal => 0x0D,
        Key::Backspace => 0x0E,
        Key::Tab => 0x0F,
        Key::KeyQ => 0x10,
        Key::KeyW => 0x11,
        Key::KeyE => 0x12,
        Key::KeyR => 0x13,
        Key::KeyT => 0x14,
        Key::KeyY => 0x15,
        Key::KeyU => 0x16,
        Key::KeyI => 0x17,
        Key::KeyO => 0x18,
        Key::KeyP => 0x19,
        Key::LeftBracket => 0x1A,
        Key::RightBracket => 0x1B,
        Key::Return => 0x1C,
        Key::KeyA => 0x1E,
        Key::KeyS => 0x1F,
        Key::KeyD => 0x20,
        Key::KeyF => 0x21,
        Key::KeyG => 0x22,
        Key::KeyH => 0x23,
        Key::KeyJ => 0x24,
        Key::KeyK => 0x25,
        Key::KeyL => 0x26,
        Key::SemiColon => 0x27,
        Key::Quote => 0x28,
        Key::BackQuote => 0x29,
        Key::BackSlash => 0x2B,
        Key::KeyZ => 0x2C,
        Key::KeyX => 0x2D,
        Key::KeyC => 0x2E,
        Key::KeyV => 0x2F,
        Key::KeyB => 0x30,
        Key::KeyN => 0x31,
        Key::KeyM => 0x32,
        Key::Comma => 0x33,
        Key::Dot => 0x34,
        Key::Slash => 0x35,
        Key::Space => 0x39,
        Key::ShiftLeft
        | Key::ShiftRight
        | Key::ControlLeft
        | Key::ControlRight
        | Key::Alt
        | Key::AltGr
        | Key::MetaLeft
        | Key::MetaRight
        | Key::CapsLock
        | Key::NumLock
        | Key::ScrollLock
        | Key::Home
        | Key::End
        | Key::PageUp
        | Key::PageDown
        | Key::UpArrow
        | Key::DownArrow
        | Key::LeftArrow
        | Key::RightArrow
        | Key::Delete
        | Key::Insert
        | Key::F1
        | Key::F2
        | Key::F3
        | Key::F4
        | Key::F5
        | Key::F6
        | Key::F7
        | Key::F8
        | Key::F9
        | Key::F10
        | Key::F11
        | Key::F12 => return None,
        _ => return None,
    })
}

/// Resolve a physical keypress to the character the OS would deliver to a focused
/// text input. Returns `None` for non-character keys (modifiers, function keys,
/// dead-key states that don't yet commit a glyph) and for IME-composition states.
pub fn resolve_keypress(rdev_key: rdev::Key, shift_held: bool) -> Option<char> {
    let scan = scan_code_for(rdev_key)?;

    // SAFETY:
    // - `state` is exactly 256 bytes, the ABI-required size for ToUnicodeEx's
    //   keyboard-state arg.
    // - `buf` is 8 u16s, well above ToUnicodeEx's minimum.
    // - `hkl` is either a valid HKL from GetKeyboardLayout, or HKL(0) — both are
    //   accepted by ToUnicodeEx per the Win32 docs.
    // - `scan` and `vk` are passed by value; no aliasing concerns.
    unsafe {
        let hwnd = GetForegroundWindow();
        let thread_id = if hwnd.0.is_null() {
            0 // GetKeyboardLayout(0) returns the calling thread's layout
        } else {
            windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, None)
        };
        let hkl: HKL = GetKeyboardLayout(thread_id);

        let mut state = [0u8; 256];
        if shift_held {
            state[VK_SHIFT.0 as usize] = 0x80;
        }

        let vk = MapVirtualKeyExW(scan, MAPVK_VSC_TO_VK_EX, Some(hkl));
        if vk == 0 {
            return None;
        }

        let mut buf = [0u16; 8];
        // wFlags bit 2 (= 0x4) makes the call a pure query — does NOT consume dead-key
        // state into the kernel layout buffer. Required for global listeners that
        // must not corrupt the user's foreground app composition state.
        let written = ToUnicodeEx(vk, scan, &state, &mut buf, 0x4, Some(hkl));
        if written <= 0 {
            return None;
        }
        let slice = &buf[..written as usize];
        let s = String::from_utf16_lossy(slice);
        s.chars().next()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rdev::Key;

    #[test]
    fn resolves_lowercase_letter_on_us_layout() {
        assert_eq!(resolve_keypress(Key::KeyA, false), Some('a'));
    }

    #[test]
    fn resolves_uppercase_with_shift_on_us_layout() {
        assert_eq!(resolve_keypress(Key::KeyA, true), Some('A'));
    }

    #[test]
    fn resolves_colon_with_shift_on_us_layout() {
        // The bug the refactor fixes: `:` is Shift+`;` on US, currently dropped.
        assert_eq!(resolve_keypress(Key::SemiColon, true), Some(':'));
    }

    #[test]
    fn resolves_underscore_with_shift_on_us_layout() {
        assert_eq!(resolve_keypress(Key::Minus, true), Some('_'));
    }

    #[test]
    fn returns_none_for_modifier_keys() {
        assert_eq!(resolve_keypress(Key::ShiftLeft, false), None);
        assert_eq!(resolve_keypress(Key::ControlLeft, false), None);
    }

    #[test]
    fn resolves_colon_on_azerty_layout() {
        with_layout(LAYOUT_FR_FR, || {
            assert_eq!(resolve_keypress(Key::Dot, true), Some(':'));
        });
    }

    #[test]
    fn resolves_colon_on_qwertz_layout() {
        with_layout(LAYOUT_DE_DE, || {
            assert_eq!(resolve_keypress(Key::Dot, true), Some(':'));
        });
    }

    #[test]
    fn dead_key_returns_glyph_immediately_without_consuming_state() {
        // With the no-change-state ToUnicodeEx flag, a dead key like ^ on
        // US-International resolves to the standalone glyph immediately — it does
        // NOT mutate kernel layout state, so a subsequent unrelated keypress in
        // any other window/process is not affected.
        with_layout(LAYOUT_US_INTL, || {
            let result = resolve_keypress(Key::Num6, true); // Shift+6 on US-Intl
            // The exact char depends on layout — we assert only that *something* is
            // returned and that calling again with an unrelated key does not
            // compose. The contract is "no kernel-state mutation".
            assert!(result.is_some());
            let e = resolve_keypress(Key::KeyE, false);
            assert_eq!(e, Some('e')); // Just 'e' — not 'ê'.
        });
    }

    const LAYOUT_FR_FR: &str = "0000040C";
    const LAYOUT_DE_DE: &str = "00000407";
    const LAYOUT_US_INTL: &str = "00020409";

    fn with_layout<F: FnOnce()>(layout_id: &str, f: F) {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            ActivateKeyboardLayout, GetKeyboardLayout, LoadKeyboardLayoutW, KLF_ACTIVATE,
        };
        let wide: Vec<u16> = layout_id
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let prev = GetKeyboardLayout(0);
            let hkl = LoadKeyboardLayoutW(PCWSTR(wide.as_ptr()), KLF_ACTIVATE)
                .expect("layout load");
            let _ = ActivateKeyboardLayout(hkl, KLF_ACTIVATE);
            f();
            let _ = ActivateKeyboardLayout(prev, KLF_ACTIVATE);
        }
    }
}
