use crate::{
    error::AppError,
    storage::{query_history, DataStore},
};
use tauri::State;

#[tauri::command]
pub async fn query_history_list(store: State<'_, DataStore>) -> Result<Vec<String>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || query_history::list(&*store.conn()?))
        .await
        .map_err(|e| AppError::Database(e.to_string()))?
}

#[tauri::command]
pub async fn query_history_record(
    store: State<'_, DataStore>,
    query: String,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || query_history::record(&*store.conn()?, &query))
        .await
        .map_err(|e| AppError::Database(e.to_string()))?
}

#[tauri::command]
pub async fn query_history_delete(
    store: State<'_, DataStore>,
    query: String,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || query_history::delete(&*store.conn()?, &query))
        .await
        .map_err(|e| AppError::Database(e.to_string()))?
}
