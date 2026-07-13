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
    // Resolve against the layout of the *foreground window's* thread — the
    // layout that would actually receive the keystroke.
    let hkl: HKL = unsafe {
        let hwnd = GetForegroundWindow();
        let thread_id = if hwnd.0.is_null() {
            0 // GetKeyboardLayout(0) returns the calling thread's layout
        } else {
            windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, None)
        };
        GetKeyboardLayout(thread_id)
    };
    resolve_with_hkl(rdev_key, shift_held, hkl)
}

/// Core resolution against an explicit keyboard layout. Split out from
/// [`resolve_keypress`] so tests can drive a specific layout by its `HKL`
/// (obtained via `LoadKeyboardLayoutW`) *without activating it on the
/// desktop* — activation would mutate the user's input list / language bar.
fn resolve_with_hkl(rdev_key: rdev::Key, shift_held: bool, hkl: HKL) -> Option<char> {
    let scan = scan_code_for(rdev_key)?;

    // SAFETY:
    // - `state` is exactly 256 bytes, the ABI-required size for ToUnicodeEx's
    //   keyboard-state arg.
    // - `buf` is 8 u16s, well above ToUnicodeEx's minimum.
    // - `hkl` is either a valid HKL from GetKeyboardLayout/LoadKeyboardLayoutW,
    //   or HKL(0) — all accepted by ToUnicodeEx per the Win32 docs.
    // - `scan` and `vk` are passed by value; no aliasing concerns.
    unsafe {
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
        with_layout_hkl(LAYOUT_US, |hkl| {
            assert_eq!(resolve_with_hkl(Key::KeyA, false, hkl), Some('a'));
        });
    }

    #[test]
    fn resolves_uppercase_with_shift_on_us_layout() {
        with_layout_hkl(LAYOUT_US, |hkl| {
            assert_eq!(resolve_with_hkl(Key::KeyA, true, hkl), Some('A'));
        });
    }

    #[test]
    fn resolves_colon_with_shift_on_us_layout() {
        // The bug the refactor fixes: `:` is Shift+`;` on US, currently dropped.
        with_layout_hkl(LAYOUT_US, |hkl| {
            assert_eq!(resolve_with_hkl(Key::SemiColon, true, hkl), Some(':'));
        });
    }

    #[test]
    fn resolves_underscore_with_shift_on_us_layout() {
        with_layout_hkl(LAYOUT_US, |hkl| {
            assert_eq!(resolve_with_hkl(Key::Minus, true, hkl), Some('_'));
        });
    }

    #[test]
    fn returns_none_for_modifier_keys() {
        // Modifiers have no scancode mapping, so resolution bails before any
        // layout is consulted — safe to exercise the public entry point.
        assert_eq!(resolve_keypress(Key::ShiftLeft, false), None);
        assert_eq!(resolve_keypress(Key::ControlLeft, false), None);
    }

    #[test]
    fn resolves_colon_on_azerty_layout() {
        // On French AZERTY the US-`.` physical key is `:` unshifted (and `/`
        // shifted) — unlike German QWERTZ below, where `:` is Shift+`.`.
        with_layout_hkl(LAYOUT_FR_FR, |hkl| {
            assert_eq!(resolve_with_hkl(Key::Dot, false, hkl), Some(':'));
        });
    }

    #[test]
    fn resolves_colon_on_qwertz_layout() {
        with_layout_hkl(LAYOUT_DE_DE, |hkl| {
            assert_eq!(resolve_with_hkl(Key::Dot, true, hkl), Some(':'));
        });
    }

    #[test]
    fn dead_key_query_leaves_no_kernel_state() {
        // Shift+6 on US-International is the `^` dead key. Per the resolver's
        // contract it doesn't commit a standalone glyph (ToUnicodeEx returns a
        // negative dead-key result → None). The load-bearing guarantee this
        // test protects is the no-change-state flag (wFlags bit 2): querying
        // the dead key must NOT leave composition state in the kernel layout
        // buffer, so a subsequent unrelated keypress in any window resolves to
        // itself rather than composing.
        with_layout_hkl(LAYOUT_US_INTL, |hkl| {
            let _ = resolve_with_hkl(Key::Num6, true, hkl); // ^ dead key: no commit
            let e = resolve_with_hkl(Key::KeyE, false, hkl);
            assert_eq!(e, Some('e')); // Just 'e' — not the composed 'ê'.
        });
    }

    const LAYOUT_US: &str = "00000409";
    const LAYOUT_FR_FR: &str = "0000040C";
    const LAYOUT_DE_DE: &str = "00000407";
    const LAYOUT_US_INTL: &str = "00020409";

    /// Load `layout_id`, hand its `HKL` to `f`, then unload it — **without
    /// ever activating it on the desktop**. The previous `with_layout` used
    /// `LoadKeyboardLayoutW(KLF_ACTIVATE)` + `ActivateKeyboardLayout`, which
    /// (a) mutated the user's real input list / language bar and left the
    /// loaded layouts behind (only the *active* one was restored), and
    /// (b) didn't even work — `resolve_keypress` reads the *foreground
    /// window's* layout, not the test thread's, so activating on the test
    /// thread had no effect. Here we load with `KLF_NOTELLSHELL` (no shell
    /// notification, no activation), drive `resolve_with_hkl` against the
    /// returned HKL directly, and `UnloadKeyboardLayout` it — but only if it
    /// wasn't already loaded, so a layout the user actually installed is
    /// never removed. Net effect on the OS: none.
    fn with_layout_hkl<F: FnOnce(HKL)>(layout_id: &str, f: F) {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            GetKeyboardLayoutList, LoadKeyboardLayoutW, UnloadKeyboardLayout, KLF_NOTELLSHELL,
        };
        let wide: Vec<u16> = layout_id.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            // Snapshot already-loaded layouts so we only unload one we add.
            let count = GetKeyboardLayoutList(None).max(0) as usize;
            let mut before = vec![HKL::default(); count];
            let got = GetKeyboardLayoutList(Some(before.as_mut_slice())).max(0) as usize;
            before.truncate(got);

            let hkl = LoadKeyboardLayoutW(PCWSTR(wide.as_ptr()), KLF_NOTELLSHELL)
                .expect("layout load");
            f(hkl);
            if !before.contains(&hkl) {
                let _ = UnloadKeyboardLayout(hkl);
            }
        }
    }
}
