//! Linux keypress resolver: rdev scancode → Unicode char via libxkbcommon.
//! Honors the active xkb layout, shift state, and dead keys. Pure-Wayland
//! sessions (no $DISPLAY) are detected at init and the resolver becomes a
//! permanent no-op after emitting one diagnostic.
//!
//! ## Layout-switch limitation
//!
//! The active xkb keymap is loaded once on first use and cached for process
//! lifetime. If the user changes their keyboard layout mid-session (e.g.
//! `setxkbmap fr`, GNOME's layout indicator, KDE's layout switcher), the
//! resolver keeps returning chars for the original layout until Asyar
//! restarts. Live layout-change tracking via XKB event subscription is a
//! separate follow-up — the Windows resolver gets this for free via
//! `GetKeyboardLayout` per call, but xkbcommon has no equivalent fast query.

#![cfg(target_os = "linux")]

use std::sync::{Mutex, OnceLock};
use xkbcommon::xkb;

struct XkbResolver {
    state: xkb::State,
    shift_mod_index: xkb::ModIndex,
}

// SAFETY: `xkb::State` wraps `*mut xkb_state`, which is `!Send` by default.
// libxkbcommon does not document the state object as thread-safe, but it IS
// safe to MOVE between threads as long as concurrent access is serialized.
// Every touch of the inner state goes through `RESOLVER.lock()`, so only one
// thread can ever hold a reference at a time — making the move-between-threads
// requirement of `Send` trivially satisfied.
unsafe impl Send for XkbResolver {}

// LIMITATION: process-lifetime keymap cache. Live layout updates require
// subscribing to XKB events (XkbStateNotify / XkbNewKeyboardNotify), which
// is a separate follow-up.
static RESOLVER: Mutex<Option<XkbResolver>> = Mutex::new(None);
static INIT_DONE: OnceLock<()> = OnceLock::new();

/// True if `$WAYLAND_DISPLAY` is set and `$DISPLAY` is empty/unset.
fn is_pure_wayland_session() -> bool {
    let has_wayland = std::env::var_os("WAYLAND_DISPLAY")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    let has_x11 = std::env::var_os("DISPLAY")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    has_wayland && !has_x11
}

fn init_resolver() -> Option<XkbResolver> {
    if is_pure_wayland_session() {
        log::warn!(
            "[snippets] pure-Wayland session detected; system-wide shortcode \
             expansion requires X11 or XWayland. Inline picker still works."
        );
        return None;
    }

    let context = xkb::Context::new(xkb::CONTEXT_NO_FLAGS);
    let keymap = match xkb::Keymap::new_from_names(
        &context,
        "",
        "",
        "",
        "",
        None,
        xkb::KEYMAP_COMPILE_NO_FLAGS,
    ) {
        Some(k) => k,
        None => {
            log::warn!(
                "[snippets] xkb keymap compile failed (rules/model/layout/variant \
                 defaults). System-wide shortcode expansion disabled."
            );
            return None;
        }
    };
    let shift_mod_index = keymap.mod_get_index(xkb::MOD_NAME_SHIFT);
    if shift_mod_index == xkb::MOD_INVALID {
        log::warn!("[snippets] xkb keymap has no SHIFT modifier; resolver disabled");
        return None;
    }
    let state = xkb::State::new(&keymap);
    Some(XkbResolver {
        state,
        shift_mod_index,
    })
}

fn scan_code_to_xkb_keycode(key: rdev::Key) -> Option<u32> {
    use rdev::Key;
    // xkb keycodes are evdev codes + 8 (X11 offset). evdev codes per
    // /usr/include/linux/input-event-codes.h.
    Some(match key {
        Key::Escape => 1 + 8,
        Key::Num1 => 2 + 8,
        Key::Num2 => 3 + 8,
        Key::Num3 => 4 + 8,
        Key::Num4 => 5 + 8,
        Key::Num5 => 6 + 8,
        Key::Num6 => 7 + 8,
        Key::Num7 => 8 + 8,
        Key::Num8 => 9 + 8,
        Key::Num9 => 10 + 8,
        Key::Num0 => 11 + 8,
        Key::Minus => 12 + 8,
        Key::Equal => 13 + 8,
        Key::Backspace => 14 + 8,
        Key::Tab => 15 + 8,
        Key::KeyQ => 16 + 8,
        Key::KeyW => 17 + 8,
        Key::KeyE => 18 + 8,
        Key::KeyR => 19 + 8,
        Key::KeyT => 20 + 8,
        Key::KeyY => 21 + 8,
        Key::KeyU => 22 + 8,
        Key::KeyI => 23 + 8,
        Key::KeyO => 24 + 8,
        Key::KeyP => 25 + 8,
        Key::LeftBracket => 26 + 8,
        Key::RightBracket => 27 + 8,
        Key::Return => 28 + 8,
        Key::KeyA => 30 + 8,
        Key::KeyS => 31 + 8,
        Key::KeyD => 32 + 8,
        Key::KeyF => 33 + 8,
        Key::KeyG => 34 + 8,
        Key::KeyH => 35 + 8,
        Key::KeyJ => 36 + 8,
        Key::KeyK => 37 + 8,
        Key::KeyL => 38 + 8,
        Key::SemiColon => 39 + 8,
        Key::Quote => 40 + 8,
        Key::BackQuote => 41 + 8,
        Key::BackSlash => 43 + 8,
        Key::KeyZ => 44 + 8,
        Key::KeyX => 45 + 8,
        Key::KeyC => 46 + 8,
        Key::KeyV => 47 + 8,
        Key::KeyB => 48 + 8,
        Key::KeyN => 49 + 8,
        Key::KeyM => 50 + 8,
        Key::Comma => 51 + 8,
        Key::Dot => 52 + 8,
        Key::Slash => 53 + 8,
        Key::Space => 57 + 8,
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

/// RAII guard that snapshots the xkb modifier+layout state on construction
/// and restores it on drop — even if the wrapped query panics. Required so
/// that an FFI surprise can't leave the cached `xkb::State` polluted with
/// synthetic modifier bits for the next call.
struct ModifierGuard<'s> {
    state: &'s mut xkb::State,
    depressed: xkb::ModMask,
    latched: xkb::ModMask,
    locked: xkb::ModMask,
    dep_layout: xkb::LayoutIndex,
    lat_layout: xkb::LayoutIndex,
    lock_layout: xkb::LayoutIndex,
}

impl<'s> ModifierGuard<'s> {
    /// Snapshot the current modifier/layout state, then immediately overwrite
    /// it with the supplied synthetic depressed-modifier mask (all latched,
    /// locked, and layout fields cleared). The original state is restored
    /// when the guard is dropped.
    fn enter(state: &'s mut xkb::State, synthetic_depressed: xkb::ModMask) -> Self {
        let depressed = state.serialize_mods(xkb::STATE_MODS_DEPRESSED);
        let latched = state.serialize_mods(xkb::STATE_MODS_LATCHED);
        let locked = state.serialize_mods(xkb::STATE_MODS_LOCKED);
        let dep_layout = state.serialize_layout(xkb::STATE_LAYOUT_DEPRESSED);
        let lat_layout = state.serialize_layout(xkb::STATE_LAYOUT_LATCHED);
        let lock_layout = state.serialize_layout(xkb::STATE_LAYOUT_LOCKED);

        state.update_mask(synthetic_depressed, 0, 0, 0, 0, 0);

        Self {
            state,
            depressed,
            latched,
            locked,
            dep_layout,
            lat_layout,
            lock_layout,
        }
    }
}

impl Drop for ModifierGuard<'_> {
    fn drop(&mut self) {
        self.state.update_mask(
            self.depressed,
            self.latched,
            self.locked,
            self.dep_layout,
            self.lat_layout,
            self.lock_layout,
        );
    }
}

/// Resolve a physical keypress (rdev::Key) into the Unicode char it would
/// commit on the active xkb layout, considering the caller-declared shift state.
/// Pure query — does not mutate dead-key composition state.
/// Returns `None` for non-character keys and on pure-Wayland sessions.
pub fn resolve_keypress(rdev_key: rdev::Key, shift_held: bool) -> Option<char> {
    INIT_DONE.get_or_init(|| {
        let mut guard = RESOLVER.lock().expect("resolver mutex poisoned");
        *guard = init_resolver();
    });

    let mut guard = RESOLVER.lock().ok()?;
    let resolver = guard.as_mut()?;
    let keycode = scan_code_to_xkb_keycode(rdev_key)?;

    let synthetic_depressed: xkb::ModMask = if shift_held {
        1u32 << resolver.shift_mod_index
    } else {
        0
    };

    let utf8 = {
        let mod_guard = ModifierGuard::enter(&mut resolver.state, synthetic_depressed);
        mod_guard.state.key_get_utf8(xkb::Keycode::new(keycode))
        // mod_guard drops here → restore runs even if key_get_utf8 panics
    };

    utf8.chars().next().filter(|c| !c.is_control())
}

#[cfg(test)]
pub(crate) fn reset_resolver_for_test() {
    // Force re-init using the current env vars. INIT_DONE can't be reset, so
    // we reach in and replace the cached resolver — subsequent calls' INIT_DONE
    // closures are no-ops, but the explicit re-init below rebuilds the keymap
    // against the freshly set $XKB_DEFAULT_LAYOUT.
    let mut guard = RESOLVER.lock().expect("resolver mutex poisoned");
    *guard = init_resolver();
}

#[cfg(test)]
mod tests {
    use super::*;
    use rdev::Key;
    use serial_test::serial;

    /// Stdlib-only RAII guard that snapshots the listed env vars on
    /// construction and restores them (set or unset) on drop. Keeps tests
    /// from leaking env mutations into sibling tests run in the same process.
    struct EnvGuard {
        saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
    }

    impl EnvGuard {
        fn for_vars(names: &[&'static str]) -> Self {
            Self {
                saved: names
                    .iter()
                    .map(|n| (*n, std::env::var_os(n)))
                    .collect(),
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (name, value) in &self.saved {
                match value {
                    Some(v) => std::env::set_var(name, v),
                    None => std::env::remove_var(name),
                }
            }
        }
    }

    const ENV_VARS: &[&str] = &["DISPLAY", "WAYLAND_DISPLAY", "XKB_DEFAULT_LAYOUT"];

    #[test]
    #[serial]
    fn detects_pure_wayland_when_only_wayland_display_set() {
        let _env = EnvGuard::for_vars(ENV_VARS);
        std::env::set_var("WAYLAND_DISPLAY", "wayland-0");
        std::env::remove_var("DISPLAY");
        assert!(is_pure_wayland_session());
    }

    #[test]
    #[serial]
    fn rejects_pure_wayland_when_display_set_too() {
        let _env = EnvGuard::for_vars(ENV_VARS);
        std::env::set_var("WAYLAND_DISPLAY", "wayland-0");
        std::env::set_var("DISPLAY", ":0");
        assert!(!is_pure_wayland_session());
    }

    #[test]
    #[serial]
    fn resolves_lowercase_letter_on_us_layout() {
        let _env = EnvGuard::for_vars(ENV_VARS);
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::set_var("DISPLAY", ":0");
        std::env::set_var("XKB_DEFAULT_LAYOUT", "us");
        reset_resolver_for_test();
        assert_eq!(resolve_keypress(Key::KeyA, false), Some('a'));
    }

    #[test]
    #[serial]
    fn resolves_colon_on_us_layout_with_shift() {
        let _env = EnvGuard::for_vars(ENV_VARS);
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::set_var("DISPLAY", ":0");
        std::env::set_var("XKB_DEFAULT_LAYOUT", "us");
        reset_resolver_for_test();
        assert_eq!(resolve_keypress(Key::SemiColon, true), Some(':'));
    }

    #[test]
    #[serial]
    fn resolves_colon_on_french_azerty() {
        let _env = EnvGuard::for_vars(ENV_VARS);
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::set_var("DISPLAY", ":0");
        std::env::set_var("XKB_DEFAULT_LAYOUT", "fr");
        reset_resolver_for_test();
        assert_eq!(resolve_keypress(Key::Dot, true), Some(':'));
    }

    #[test]
    #[serial]
    fn returns_none_for_modifier_keys() {
        let _env = EnvGuard::for_vars(ENV_VARS);
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::set_var("DISPLAY", ":0");
        std::env::set_var("XKB_DEFAULT_LAYOUT", "us");
        reset_resolver_for_test();
        assert_eq!(resolve_keypress(Key::ShiftLeft, false), None);
    }

    #[test]
    #[serial]
    fn dead_key_returns_glyph_immediately_without_consuming_state() {
        // The call is a pure query that does not advance dead-key composition
        // state. The current `us` layout has no dead keys on Num6+Shift, so
        // this test only exercises the structural invariant (no kernel-state
        // mutation between two unrelated calls). Real dead-key proof needs
        // `us(intl)` installed on a Linux CI runner — deferred follow-up.
        let _env = EnvGuard::for_vars(ENV_VARS);
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::set_var("DISPLAY", ":0");
        std::env::set_var("XKB_DEFAULT_LAYOUT", "us");
        reset_resolver_for_test();
        let _ = resolve_keypress(Key::Num6, true);
        let follow = resolve_keypress(Key::KeyE, false);
        assert_eq!(follow, Some('e'));
    }
}
