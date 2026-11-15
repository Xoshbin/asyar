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

#[tauri::command]
pub async fn ocr_recognize_image_file(image_path: String) -> Result<Option<String>, AppError> {
    let path = std::path::PathBuf::from(image_path);
    tauri::async_runtime::spawn_blocking(move || {
        let text = crate::ocr::extract_text_from_image_file(&path)?;
        if text.trim().is_empty() {
            Ok(None)
        } else {
            Ok(Some(text))
        }
    })
    .await
    .map_err(|e| AppError::Platform(format!("OCR task failed: {e}")))?
}

#[tauri::command]
pub async fn ocr_copy_image_text(
    app_handle: tauri::AppHandle,
    image_path: String,
) -> Result<Option<String>, AppError> {
    let path = std::path::PathBuf::from(image_path);
    crate::ocr::copy_text_from_image_file(&app_handle, &path).await
}
