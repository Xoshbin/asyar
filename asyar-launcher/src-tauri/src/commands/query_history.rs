use crate::{error::AppError, query_history::QueryHistoryService, storage::DataStore};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn query_history_navigate(
    service: State<'_, Arc<QueryHistoryService>>,
    store: State<'_, DataStore>,
    session_id: String,
    direction: i32,
) -> Result<Option<String>, AppError> {
    let service = service.inner().clone();
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.navigate(&*store.conn()?, &session_id, direction)
    })
    .await
    .map_err(|e| AppError::Database(e.to_string()))?
}

#[tauri::command]
pub async fn query_history_record(
    service: State<'_, Arc<QueryHistoryService>>,
    store: State<'_, DataStore>,
    query: String,
) -> Result<(), AppError> {
    let service = service.inner().clone();
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.record(&*store.conn()?, &query))
        .await
        .map_err(|e| AppError::Database(e.to_string()))?
}

#[tauri::command]
pub async fn query_history_delete(
    service: State<'_, Arc<QueryHistoryService>>,
    store: State<'_, DataStore>,
    query: String,
) -> Result<(), AppError> {
    let service = service.inner().clone();
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.delete(&*store.conn()?, &query))
        .await
        .map_err(|e| AppError::Database(e.to_string()))?
}

#[tauri::command]
pub async fn query_history_reset(
    service: State<'_, Arc<QueryHistoryService>>,
) -> Result<(), AppError> {
    service.reset();
    Ok(())
}

#[tauri::command]
pub async fn query_history_list(store: State<'_, DataStore>) -> Result<Vec<String>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::storage::query_history::list(&*store.conn()?)
    })
    .await
    .map_err(|e| AppError::Database(e.to_string()))?
}
