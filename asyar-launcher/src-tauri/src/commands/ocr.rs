//! Tauri command layer for screen capture OCR.

use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub async fn ocr_capture_screen_text(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    crate::ocr::capture_screen_text(&app_handle, &state).await
}
