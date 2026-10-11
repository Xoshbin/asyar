//! Launcher-only read access. SQL aggregation and retention belong to storage.
use crate::error::AppError;
use crate::storage::DataStore;
use asyar_storage::ai_usage::AiUsageSummary;

#[tauri::command]
pub async fn ai_usage_summary(
    store: tauri::State<'_, DataStore>,
    since_ms: i64,
) -> Result<AiUsageSummary, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = store.conn()?;
        asyar_storage::ai_usage::summary(&conn, since_ms).map_err(AppError::from)
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))?
}
