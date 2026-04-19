use crate::error::AppError;
use crate::storage::command_arg_defaults as store;
use crate::storage::DataStore;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn command_arg_defaults_get(
    extension_id: String,
    command_id: String,
    data_store: State<'_, DataStore>,
) -> Result<HashMap<String, String>, AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation(
            "extension_id cannot be empty".to_string(),
        ));
    }
    if command_id.trim().is_empty() {
        return Err(AppError::Validation(
            "command_id cannot be empty".to_string(),
        ));
    }
    let conn = data_store.conn()?;
    store::get(&conn, &extension_id, &command_id)
}

#[tauri::command]
pub async fn command_arg_defaults_set(
    extension_id: String,
    command_id: String,
    values: HashMap<String, String>,
    data_store: State<'_, DataStore>,
) -> Result<(), AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation(
            "extension_id cannot be empty".to_string(),
        ));
    }
    if command_id.trim().is_empty() {
        return Err(AppError::Validation(
            "command_id cannot be empty".to_string(),
        ));
    }
    let conn = data_store.conn()?;
    store::set(&conn, &extension_id, &command_id, &values)
}
