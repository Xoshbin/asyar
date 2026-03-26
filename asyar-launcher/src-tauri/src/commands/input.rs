use enigo::{Enigo, KeyboardControllable};

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

/// Sends N backspaces then Cmd+V. Frontend must write expansion to clipboard first.
#[tauri::command]
pub fn expand_and_paste(keyword_len: u32) -> Result<(), String> {
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
