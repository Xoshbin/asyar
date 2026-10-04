//! Cross-platform keyboard layout resolution abstractions.

pub trait KeyboardLayoutResolver {
    #[cfg(not(target_os = "macos"))]
    fn resolve_keypress(&self, key: &rdev::Key, shift_held: bool) -> Option<char>;
}

/// System-default keyboard layout resolver dispatching to the active platform's OS APIs.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemKeyboardResolver;

impl KeyboardLayoutResolver for SystemKeyboardResolver {
    #[cfg(not(target_os = "macos"))]
    fn resolve_keypress(&self, key: &rdev::Key, shift_held: bool) -> Option<char> {
        #[cfg(target_os = "windows")]
        {
            crate::windows_key_resolver::resolve_keypress(*key, shift_held)
        }
        #[cfg(target_os = "linux")]
        {
            crate::linux_key_resolver::resolve_keypress(*key, shift_held)
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let _ = (key, shift_held);
            None
        }
    }
}

/// Resolves a keypress using the system's active keyboard layout on Windows/Linux.
#[cfg(not(target_os = "macos"))]
pub fn resolve_keypress(key: &rdev::Key, shift_held: bool) -> Option<char> {
    SystemKeyboardResolver.resolve_keypress(key, shift_held)
}
