//! Keyboard input simulation commands.
//!
//! Provides paste simulation and keyword expansion-and-paste functionality.

use enigo::{Enigo, KeyboardControllable};
use crate::error::AppError;

/// Simulates a system-level paste keystroke (Cmd+V / Ctrl+V).
#[tauri::command]
pub fn simulate_paste() {
    let mut enigo = Enigo::new();
    #[cfg(target_os = "macos")]
    {
        enigo.key_down(enigo::Key::Meta);
        enigo.key_click(enigo::Key::Layout('v'));
        enigo.key_up(enigo::Key::Meta);
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo.key_down(enigo::Key::Control);
        enigo.key_click(enigo::Key::Layout('v'));
        enigo.key_up(enigo::Key::Control);
    }
}

/// Replaces the typed keyword (of `keyword_len` characters) with expanded text via paste.
#[tauri::command]
pub fn expand_and_paste(keyword_len: u32) -> Result<(), AppError> {
    let mut enigo = Enigo::new();
    for _ in 0..keyword_len {
        enigo.key_click(enigo::Key::Backspace);
        std::thread::sleep(std::time::Duration::from_millis(8));
    }
    std::thread::sleep(std::time::Duration::from_millis(50));
    // macOS uses Cmd+V; Windows and Linux use Ctrl+V
    #[cfg(target_os = "macos")]
    {
        enigo.key_down(enigo::Key::Meta);
        enigo.key_click(enigo::Key::Layout('v'));
        enigo.key_up(enigo::Key::Meta);
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo.key_down(enigo::Key::Control);
        enigo.key_click(enigo::Key::Layout('v'));
        enigo.key_up(enigo::Key::Control);
    }
    Ok(())
}
