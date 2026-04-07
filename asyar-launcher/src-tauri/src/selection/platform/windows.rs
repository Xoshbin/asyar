use crate::selection::error::SelectionError;

pub fn get_selected_text_via_a11y() -> Option<String> {
    None // TODO: Implement UI Automation fast path
}

pub fn is_accessibility_trusted() -> bool {
    true // Not directly applicable the same way as macOS
}

pub fn open_accessibility_prefs() {
    // No-op
}

pub fn clipboard_change_marker() -> u32 {
    #[link(name = "user32")]
    extern "system" {
        fn GetClipboardSequenceNumber() -> u32;
    }
    unsafe { GetClipboardSequenceNumber() }
}

pub fn get_selected_finder_items() -> Result<Vec<String>, SelectionError> {
    // TODO: Implement IShellWindows COM enumeration
    Ok(vec![])
}

pub struct ClipboardGuard {
    // TODO: multi-format snapshot — currently text-only, images will be lost
    text: Option<String>,
}

impl ClipboardGuard {
    pub fn new() -> Self {
        use arboard::Clipboard;
        let mut cb = Clipboard::new().ok();
        Self {
            text: cb.as_mut().and_then(|c| c.get_text().ok()),
        }
    }
}

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        if let Some(text) = &self.text {
            use arboard::Clipboard;
            if let Ok(mut cb) = Clipboard::new() {
                let _ = cb.set_text(text.clone());
            }
        }
    }
}
