//! Tauri commands for end-to-end encrypted cloud sync.
//!
//! Thin wrappers over `sync::e2ee::service::E2eeService`. Each command
//! resolves the auth token from `AuthState`, constructs an `E2eeService`
//! by composing the managed `ApiClient`, `KeyStore`, and `DataStore`,
//! and delegates to the service method.

use crate::auth::api_client::ApiClient;
use crate::auth::state::AuthState;
use crate::crypto::keystore::KeyStore;
use crate::error::AppError;
use crate::storage::DataStore;
use crate::sync::e2ee::service::{E2eeService, E2eeStatusReport, EnrolmentResult};
use std::sync::Arc;
use tauri::State;

const MIN_PASSPHRASE_LEN: usize = 12;
const MAX_PASSPHRASE_LEN: usize = 256;

fn validate_passphrase(p: &str) -> Result<(), AppError> {
    let len = p.chars().count();
    if len < MIN_PASSPHRASE_LEN {
        return Err(AppError::Validation(format!(
            "passphrase must be at least {MIN_PASSPHRASE_LEN} characters"
        )));
    }
    if len > MAX_PASSPHRASE_LEN {
        return Err(AppError::Validation(format!(
            "passphrase must be at most {MAX_PASSPHRASE_LEN} characters"
        )));
    }
    Ok(())
}

fn read_token(auth_state: &AuthState) -> Result<String, AppError> {
    auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))
}

#[tauri::command]
pub async fn sync_e2ee_get_status(
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<E2eeStatusReport, AppError> {
    let svc = E2eeService {
        api: &api_client,
        keystore: &**keystore,
        data_store: &data_store,
    };
    svc.status()
}

#[tauri::command]
pub async fn sync_e2ee_enrol(
    passphrase: String,
    auth_state: State<'_, AuthState>,
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<EnrolmentResult, AppError> {
    validate_passphrase(&passphrase)?;
    let token = read_token(&auth_state)?;
    let svc = E2eeService {
        api: &api_client,
        keystore: &**keystore,
        data_store: &data_store,
    };
    svc.enrol(&token, &passphrase).await
}

#[tauri::command]
pub async fn sync_e2ee_unlock(
    passphrase: String,
    auth_state: State<'_, AuthState>,
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let token = read_token(&auth_state)?;
    let svc = E2eeService {
        api: &api_client,
        keystore: &**keystore,
        data_store: &data_store,
    };
    svc.unlock(&token, &passphrase).await
}

#[tauri::command]
pub async fn sync_e2ee_rotate(
    old_passphrase: String,
    new_passphrase: String,
    auth_state: State<'_, AuthState>,
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<(), AppError> {
    validate_passphrase(&new_passphrase)?;
    let token = read_token(&auth_state)?;
    let svc = E2eeService {
        api: &api_client,
        keystore: &**keystore,
        data_store: &data_store,
    };
    svc.rotate(&token, &old_passphrase, &new_passphrase).await
}

#[tauri::command]
pub async fn sync_e2ee_recover_with_mnemonic(
    phrase: String,
    new_passphrase: String,
    verify_with_payload: Option<String>,
    auth_state: State<'_, AuthState>,
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<(), AppError> {
    validate_passphrase(&new_passphrase)?;
    let token = read_token(&auth_state)?;
    let svc = E2eeService {
        api: &api_client,
        keystore: &**keystore,
        data_store: &data_store,
    };
    svc.recover_with_mnemonic(
        &token,
        &phrase,
        &new_passphrase,
        verify_with_payload.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn sync_e2ee_disable(
    auth_state: State<'_, AuthState>,
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let token = read_token(&auth_state)?;
    let svc = E2eeService {
        api: &api_client,
        keystore: &**keystore,
        data_store: &data_store,
    };
    svc.disable(&token).await
}

#[tauri::command]
pub async fn sync_e2ee_show_recovery_phrase(
    passphrase: String,
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<String, AppError> {
    let svc = E2eeService {
        api: &api_client,
        keystore: &**keystore,
        data_store: &data_store,
    };
    svc.show_recovery_phrase(&passphrase)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_passphrase_rejects_short() {
        assert!(matches!(
            validate_passphrase("short"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn validate_passphrase_rejects_too_long() {
        let long = "x".repeat(300);
        assert!(matches!(
            validate_passphrase(&long),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn validate_passphrase_accepts_12_to_256() {
        assert!(validate_passphrase("twelve_chars").is_ok());
        let max = "y".repeat(256);
        assert!(validate_passphrase(&max).is_ok());
    }

    #[test]
    fn validate_passphrase_counts_unicode_chars_not_bytes() {
        // 12 emoji = 12 chars but >12 bytes; should be accepted on length.
        let unicode = "🔒".repeat(12);
        assert!(validate_passphrase(&unicode).is_ok());
    }
}
