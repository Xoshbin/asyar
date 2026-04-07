use crate::selection::error::SelectionError;

pub fn get_selected_text_via_a11y() -> Option<String> {
    None // TODO: Implement AT-SPI check
}

pub fn is_accessibility_trusted() -> bool {
    true
}

pub fn open_accessibility_prefs() {
}

pub fn clipboard_change_marker() -> [u8; 32] {
    // TODO: multi-format snapshot — currently text-only, images will be lost
    use sha2::{Sha256, Digest};
    use arboard::Clipboard;
    if let Ok(mut cb) = Clipboard::new() {
        if let Ok(text) = cb.get_text() {
            let mut hasher = Sha256::new();
            hasher.update(text.as_bytes());
            return hasher.finalize().into();
        }
    }
    [0u8; 32]
}

pub fn get_selected_finder_items() -> Result<Vec<String>, SelectionError> {
    // TODO: Implement Tier-A (clipboard URI list)
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
