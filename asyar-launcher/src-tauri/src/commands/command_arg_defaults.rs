use crate::error::AppError;
use crate::storage::command_arg_defaults as store;
use crate::storage::DataStore;
use std::collections::HashMap;
use tauri::State;

/// Build the storage key for a command id, applying the `dynamic:` prefix
/// server-side so callers never hand-mirror `store::dynamic_command_id_key`.
fn storage_key(command_id: &str, is_dynamic: bool) -> String {
    if is_dynamic {
        store::dynamic_command_id_key(command_id)
    } else {
        command_id.to_string()
    }
}

#[tauri::command]
pub async fn command_arg_defaults_get(
    extension_id: String,
    command_id: String,
    is_dynamic: bool,
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
    store::get(&conn, &extension_id, &storage_key(&command_id, is_dynamic))
}

#[tauri::command]
pub async fn command_arg_defaults_set(
    extension_id: String,
    command_id: String,
    is_dynamic: bool,
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
    store::set(
        &conn,
        &extension_id,
        &storage_key(&command_id, is_dynamic),
        &values,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_key_prefixes_dynamic_ids_only() {
        assert_eq!(storage_key("open", false), "open");
        assert_eq!(storage_key("open", true), "dynamic:open");
    }
}
