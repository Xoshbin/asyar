use crate::selection::error::SelectionError;

use arboard::Clipboard;
use percent_encoding::percent_decode_str;

/// AT-SPI fast path — not yet implemented (clipboard fallback is used instead).
/// The atspi crate API is still evolving; this will be wired up in a follow-up.
pub async fn get_selected_text_via_a11y() -> Option<String> {
    None
}

pub fn is_accessibility_trusted() -> bool {
    true
}

pub fn open_accessibility_prefs() {
}

pub fn clipboard_change_marker() -> [u8; 32] {
    // TODO: multi-format snapshot — currently text-only, images will be lost
    use sha2::{Sha256, Digest};
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
    // Tier A: simulate Ctrl+C, read clipboard text/uri-list target
    // Snapshot current clipboard before we modify it
    let before_text = Clipboard::new().ok()
        .and_then(|mut c| c.get_text().ok());

    // Post Ctrl+C to frontmost window
    crate::platform::input::post_key_chord_via_enigo(
        enigo::Key::Control, 'c');

    // Wait for the file manager to process it
    std::thread::sleep(std::time::Duration::from_millis(150));

    // Read clipboard — expect text/uri-list (newline-separated file:// URIs)
    let result = Clipboard::new()
        .map_err(|e| SelectionError::OperationFailed(e.to_string()))?
        .get_text()
        .ok()
        .map(|text| {
            text.lines()
                .filter(|l| l.starts_with("file://"))
                .filter_map(|l| {
                    // Decode percent-encoding and strip "file://"
                    let path = &l[7..];
                    Some(percent_decode(path))
                })
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();

    // Restore original clipboard
    if let Some(text) = before_text {
        let _ = Clipboard::new().map(|mut c| c.set_text(text));
    }

    Ok(result)
}

fn percent_decode(s: &str) -> String {
    percent_decode_str(s)
        .decode_utf8_lossy()
        .into_owned()
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
