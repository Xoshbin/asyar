use crate::error::AppError;
use crate::selection::service;

#[tauri::command]
pub async fn get_selected_text() -> Result<Option<String>, AppError> {
    service::get_selected_text().await.map_err(AppError::from)
}

#[tauri::command]
pub async fn get_selected_finder_items() -> Result<Vec<String>, AppError> {
    service::get_selected_finder_items().await.map_err(AppError::from)
}
