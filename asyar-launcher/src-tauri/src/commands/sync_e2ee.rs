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
use crate::sync::e2ee::pairing::PairingSessionStore;
use crate::sync::e2ee::service::{E2eeService, E2eeStatusReport, EnrolmentResult};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PairingRequestResult {
    pub id: String,
    pub fingerprint: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PairingPollResult {
    pub status: String,
}

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

#[tauri::command]
pub async fn sync_e2ee_status(
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<E2eeStatusReport, AppError> {
    sync_e2ee_get_status(keystore, api_client, data_store).await
}

#[tauri::command]
pub async fn sync_e2ee_unlock_with_phrase(
    phrase: String,
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let svc = E2eeService {
        api: &api_client,
        keystore: &**keystore,
        data_store: &data_store,
    };
    svc.unlock_with_recovery_phrase(&phrase)
}

#[tauri::command]
pub async fn sync_e2ee_show_recovery_phrase_device(
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<String, AppError> {
    let svc = E2eeService {
        api: &api_client,
        keystore: &**keystore,
        data_store: &data_store,
    };
    svc.show_recovery_phrase_device_key()
}

#[tauri::command]
pub async fn sync_e2ee_pairing_request(
    device_name: String,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
    pairing_store: State<'_, PairingSessionStore>,
) -> Result<PairingRequestResult, AppError> {
    let token = read_token(&auth_state)?;
    let (secret, public_key) = crate::sync::e2ee::pairing::generate_keypair();
    let b64_pub = B64.encode(public_key);
    let resp = api_client
        .create_pairing(&token, &device_name, &b64_pub)
        .await?;
    let fingerprint = crate::sync::e2ee::pairing::compute_pairing_fingerprint(&public_key);
    pairing_store.insert(resp.id.clone(), secret);
    Ok(PairingRequestResult {
        id: resp.id,
        fingerprint,
        expires_at: resp.expires_at,
    })
}

#[tauri::command]
pub async fn sync_e2ee_pairing_poll(
    id: String,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
    keystore: State<'_, Arc<dyn KeyStore>>,
    data_store: State<'_, DataStore>,
    pairing_store: State<'_, PairingSessionStore>,
) -> Result<PairingPollResult, AppError> {
    let token = read_token(&auth_state)?;
    let poll_resp = api_client.poll_pairing(&token, &id).await?;

    if poll_resp.status == "approved" {
        let secret = pairing_store
            .take(&id)
            .ok_or_else(|| AppError::Validation("pairing session expired or not found".into()))?;
        let sealed_b64 = poll_resp.sealed_seed.ok_or_else(|| {
            AppError::Validation("missing sealed seed in approved response".into())
        })?;
        let approver_pub_b64 = poll_resp.approver_public_key.ok_or_else(|| {
            AppError::Validation("missing approver public key in approved response".into())
        })?;

        let approver_pub_bytes: [u8; 32] = B64
            .decode(&approver_pub_b64)
            .map_err(|_| AppError::Validation("invalid base64 in approver public key".into()))?
            .try_into()
            .map_err(|_| AppError::Validation("approver public key wrong length".into()))?;

        // Retrieve server E2EE state to verify KCV
        let remote = api_client
            .get_e2ee_state(&token)
            .await?
            .ok_or(AppError::SyncE2eeNotEnrolled)?;
        let kcv_b64 = remote.kcv.as_deref().unwrap_or_default();
        let expected_kcv = B64
            .decode(kcv_b64)
            .map_err(|_| AppError::Validation("invalid KCV on server".into()))?;

        // Open sealed seed and verify KCV in constant time
        let seed = crate::sync::e2ee::pairing::open_sealed_seed_for_pairing(
            &secret,
            &approver_pub_bytes,
            &sealed_b64,
            &expected_kcv,
        )?;

        // Write to keystore with constant-time verification
        crate::sync::e2ee::service::write_slot_with_read_back(
            &**keystore,
            crate::sync::e2ee::service::KEYCHAIN_SLOT,
            &*seed,
        )?;

        // Fetch remote state to persist local mirror
        let svc = E2eeService {
            api: &api_client,
            keystore: &**keystore,
            data_store: &data_store,
        };
        let _ = svc.ensure_mirror_and_load_mode(&token).await;

        Ok(PairingPollResult {
            status: "approved".into(),
        })
    } else {
        if matches!(
            poll_resp.status.as_str(),
            "expired" | "cancelled" | "consumed"
        ) {
            pairing_store.remove(&id);
        }
        Ok(PairingPollResult {
            status: poll_resp.status,
        })
    }
}

#[tauri::command]
pub async fn sync_e2ee_pairing_incoming(
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
) -> Result<Vec<crate::sync::types::IncomingPairingRequest>, AppError> {
    let token = read_token(&auth_state)?;
    let items = api_client.list_pairings(&token).await?;
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let pub_bytes = B64.decode(&item.device_public_key).unwrap_or_default();
        let fingerprint = if pub_bytes.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&pub_bytes);
            crate::sync::e2ee::pairing::compute_pairing_fingerprint(&arr)
        } else {
            "??? ???".to_string()
        };
        out.push(crate::sync::types::IncomingPairingRequest {
            id: item.id,
            device_name: item.device_name,
            device_public_key: item.device_public_key,
            fingerprint,
            created_at: item.created_at,
            expires_at: item.expires_at,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn sync_e2ee_pairing_approve(
    id: String,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
    keystore: State<'_, Arc<dyn KeyStore>>,
) -> Result<(), AppError> {
    let token = read_token(&auth_state)?;
    let seed_bytes = keystore
        .read_slot(crate::sync::e2ee::service::KEYCHAIN_SLOT)?
        .ok_or_else(|| AppError::SyncE2eeLocked)?;
    if seed_bytes.len() != 32 {
        return Err(AppError::Encryption(
            "cached master_seed wrong length".into(),
        ));
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&seed_bytes);

    // Get the pending pairing to get requester's device_public_key
    let pending_items = api_client.list_pairings(&token).await?;
    let target = pending_items
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::SyncPairingNotFound)?;

    let requester_pub: [u8; 32] = B64
        .decode(&target.device_public_key)
        .map_err(|_| AppError::Validation("invalid requester public key".into()))?
        .try_into()
        .map_err(|_| AppError::Validation("requester public key wrong length".into()))?;

    // Seal seed under ephemeral approver keypair
    let (sealed_b64, approver_pub) =
        crate::sync::e2ee::pairing::seal_seed_for_pairing(&seed, &requester_pub)?;

    let approver_pub_b64 = B64.encode(approver_pub);

    api_client
        .approve_pairing(&token, &id, &sealed_b64, &approver_pub_b64)
        .await
}

#[tauri::command]
pub async fn sync_e2ee_pairing_cancel(
    id: String,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
    pairing_store: State<'_, PairingSessionStore>,
) -> Result<(), AppError> {
    let token = read_token(&auth_state)?;
    pairing_store.remove(&id);
    api_client.cancel_pairing(&token, &id).await
}

#[tauri::command]
pub async fn sync_e2ee_reset(
    auth_state: State<'_, AuthState>,
    keystore: State<'_, Arc<dyn KeyStore>>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<crate::sync::types::ResetResponse, AppError> {
    let token = read_token(&auth_state)?;
    let svc = E2eeService {
        api: &api_client,
        keystore: &**keystore,
        data_store: &data_store,
    };
    svc.reset(&token).await
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
