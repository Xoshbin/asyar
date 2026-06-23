//! Tauri command layer for [`crate::clipboard_markup`].
//!
//! Thin wrappers delegating to the pure stripping functions so the logic is
//! unit testable without a running Tauri app. Mirrors the pattern in
//! [`crate::commands::clipboard_privacy`].

#[tauri::command]
pub async fn clipboard_strip_html(content: String) -> String {
    crate::clipboard_markup::strip_html(&content)
}

#[tauri::command]
pub async fn clipboard_strip_rtf(content: String) -> String {
    crate::clipboard_markup::strip_rtf(&content)
}
