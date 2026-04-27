use crate::error::AppError;
use crate::storage::searchbar_accessory as store;
use crate::storage::DataStore;
use tauri::State;

/// Read the persisted searchbar accessory value for `(extension_id, command_id)`,
/// or `None` if nothing is stored. Validates that both ids are non-empty.
#[tauri::command]
pub async fn searchbar_accessory_get(
    extension_id: String,
    command_id: String,
    data_store: State<'_, DataStore>,
) -> Result<Option<String>, AppError> {
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

/// Persist a searchbar accessory value for `(extension_id, command_id)`.
/// Validates that both ids are non-empty. The value itself is opaque text.
#[tauri::command]
pub async fn searchbar_accessory_set(
    extension_id: String,
    command_id: String,
    value: String,
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
    store::set(&conn, &extension_id, &command_id, &value)
}

#[cfg(test)]
mod tests {
    use super::*;

    // The State<DataStore> deref happens after the validation branches,
    // so we can exercise the validation path with a small helper that
    // mirrors the validation in both commands.
    fn validate(extension_id: &str, command_id: &str) -> Result<(), AppError> {
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
        Ok(())
    }

    #[test]
    fn validation_rejects_empty_extension_id() {
        assert!(matches!(validate("", "cmd"), Err(AppError::Validation(_))));
        assert!(matches!(validate("   ", "cmd"), Err(AppError::Validation(_))));
    }

    #[test]
    fn validation_rejects_empty_command_id() {
        assert!(matches!(validate("ext", ""), Err(AppError::Validation(_))));
        assert!(matches!(validate("ext", "  "), Err(AppError::Validation(_))));
    }

    #[test]
    fn validation_accepts_non_empty_ids() {
        assert!(validate("ext", "cmd").is_ok());
    }
}
