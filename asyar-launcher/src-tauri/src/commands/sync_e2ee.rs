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
    pub confirmation_words: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PairingApproveResult {
    pub confirmation_words: String,
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
    pairing_store.insert_request(resp.id.clone(), secret, public_key);
    Ok(PairingRequestResult {
        id: resp.id,
        fingerprint,
        expires_at: resp.expires_at,
    })
}

pub async fn pairing_poll_inner(
    id: &str,
    token: &str,
    api_client: &ApiClient,
    pairing_store: &PairingSessionStore,
) -> Result<PairingPollResult, AppError> {
    // If already awaiting confirmation, return immediately and idempotently (do not call server again).
    if let Some(crate::sync::e2ee::pairing::PairingSession::AwaitingConfirmation {
        confirmation_words,
        ..
    }) = pairing_store.get(id)
    {
        return Ok(PairingPollResult {
            status: "awaiting-confirmation".into(),
            confirmation_words: Some(confirmation_words),
        });
    }

    let poll_resp = api_client.poll_pairing(token, id).await?;

    if poll_resp.status == "approved" {
        let (secret, requester_pub) = match pairing_store.get(id) {
            Some(crate::sync::e2ee::pairing::PairingSession::Requested {
                requester_secret,
                requester_pub,
                ..
            }) => (requester_secret, requester_pub),
            Some(crate::sync::e2ee::pairing::PairingSession::AwaitingConfirmation {
                confirmation_words,
                ..
            }) => {
                return Ok(PairingPollResult {
                    status: "awaiting-confirmation".into(),
                    confirmation_words: Some(confirmation_words),
                });
            }
            None => {
                return Err(AppError::Validation(
                    "pairing session expired or not found".into(),
                ))
            }
        };

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
            .get_e2ee_state(token)
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

        // Compute 6-word confirmation code from SHA-256("asyar-pair-confirm-v1" || R || A)
        let confirmation_words = crate::sync::e2ee::pairing::compute_confirmation_words(
            &requester_pub,
            &approver_pub_bytes,
        );

        // Store decrypted seed in memory awaiting user confirmation (keystore NOT written yet!)
        pairing_store.set_awaiting_confirmation(id, seed, confirmation_words.clone());

        Ok(PairingPollResult {
            status: "awaiting-confirmation".into(),
            confirmation_words: Some(confirmation_words),
        })
    } else {
        if matches!(
            poll_resp.status.as_str(),
            "expired" | "cancelled" | "consumed"
        ) {
            pairing_store.remove(id);
        }
        Ok(PairingPollResult {
            status: poll_resp.status,
            confirmation_words: None,
        })
    }
}

#[tauri::command]
pub async fn sync_e2ee_pairing_poll(
    id: String,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
    pairing_store: State<'_, PairingSessionStore>,
) -> Result<PairingPollResult, AppError> {
    let token = read_token(&auth_state)?;
    pairing_poll_inner(&id, &token, &api_client, &pairing_store).await
}

fn normalize_fingerprint(s: &str) -> String {
    s.split_whitespace()
        .map(|w| w.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ")
}

pub async fn pairing_incoming_inner(
    token: &str,
    api_client: &ApiClient,
) -> Result<Vec<crate::sync::types::IncomingPairingRequest>, AppError> {
    let items = api_client.list_pairings(token).await?;
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
pub async fn sync_e2ee_pairing_incoming(
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
) -> Result<Vec<crate::sync::types::IncomingPairingRequest>, AppError> {
    let token = read_token(&auth_state)?;
    pairing_incoming_inner(&token, &api_client).await
}

pub async fn pairing_approve_inner(
    id: &str,
    expected_fingerprint: &str,
    token: &str,
    api_client: &ApiClient,
    keystore: &dyn KeyStore,
) -> Result<PairingApproveResult, AppError> {
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
    let pending_items = api_client.list_pairings(token).await?;
    let target = pending_items
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::SyncPairingNotFound)?;

    let requester_pub: [u8; 32] = B64
        .decode(&target.device_public_key)
        .map_err(|_| AppError::Validation("invalid requester public key".into()))?
        .try_into()
        .map_err(|_| AppError::Validation("requester public key wrong length".into()))?;

    // Verify expected fingerprint matches the key we are about to seal to
    let actual_fingerprint =
        crate::sync::e2ee::pairing::compute_pairing_fingerprint(&requester_pub);
    if normalize_fingerprint(&actual_fingerprint) != normalize_fingerprint(expected_fingerprint) {
        return Err(AppError::SyncPairingFingerprintMismatch);
    }

    // Seal seed under ephemeral approver keypair
    let (sealed_b64, approver_pub) =
        crate::sync::e2ee::pairing::seal_seed_for_pairing(&seed, &requester_pub)?;

    let approver_pub_b64 = B64.encode(approver_pub);

    api_client
        .approve_pairing(token, id, &sealed_b64, &approver_pub_b64)
        .await?;

    let confirmation_words =
        crate::sync::e2ee::pairing::compute_confirmation_words(&requester_pub, &approver_pub);

    Ok(PairingApproveResult { confirmation_words })
}

#[tauri::command]
pub async fn sync_e2ee_pairing_approve(
    id: String,
    expected_fingerprint: String,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
    keystore: State<'_, Arc<dyn KeyStore>>,
) -> Result<PairingApproveResult, AppError> {
    let token = read_token(&auth_state)?;
    pairing_approve_inner(&id, &expected_fingerprint, &token, &api_client, &**keystore).await
}

pub async fn pairing_confirm_inner(
    id: &str,
    token: &str,
    api_client: &ApiClient,
    keystore: &dyn KeyStore,
    data_store: &DataStore,
    pairing_store: &PairingSessionStore,
) -> Result<(), AppError> {
    let seed = pairing_store
        .take_awaiting_confirmation(id)
        .ok_or_else(|| {
            AppError::Validation("pairing session expired or not awaiting confirmation".into())
        })?;

    // Write to keystore with constant-time verification
    crate::sync::e2ee::service::write_slot_with_read_back(
        keystore,
        crate::sync::e2ee::service::KEYCHAIN_SLOT,
        &*seed,
    )?;

    // Fetch remote state to persist local mirror
    let svc = E2eeService {
        api: api_client,
        keystore,
        data_store,
    };
    let _ = svc.ensure_mirror_and_load_mode(token).await?;

    Ok(())
}

#[tauri::command]
pub async fn sync_e2ee_pairing_confirm(
    id: String,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
    keystore: State<'_, Arc<dyn KeyStore>>,
    data_store: State<'_, DataStore>,
    pairing_store: State<'_, PairingSessionStore>,
) -> Result<(), AppError> {
    let token = read_token(&auth_state)?;
    pairing_confirm_inner(
        &id,
        &token,
        &api_client,
        &**keystore,
        &data_store,
        &pairing_store,
    )
    .await
}

pub async fn pairing_reject_inner(
    id: &str,
    token: &str,
    api_client: &ApiClient,
    pairing_store: &PairingSessionStore,
) -> Result<(), AppError> {
    pairing_store.remove(id);
    let _ = api_client.cancel_pairing(token, id).await;
    Ok(())
}

#[tauri::command]
pub async fn sync_e2ee_pairing_reject(
    id: String,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
    pairing_store: State<'_, PairingSessionStore>,
) -> Result<(), AppError> {
    let token = read_token(&auth_state)?;
    pairing_reject_inner(&id, &token, &api_client, &pairing_store).await
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

    #[tokio::test]
    async fn test_pairing_confirm_and_reject_keystore_invariants() {
        use crate::crypto::keystore::InMemoryKeyStore;
        use crate::storage::create_test_store;

        let mut server = mockito::Server::new_async().await;
        let seed = [55u8; 32];
        let kcv = crate::sync::e2ee::pairing::compute_kcv(&seed);
        let kcv_b64 = B64.encode(kcv);

        // Mock get_e2ee_state
        let _m_e2ee = server
            .mock("GET", "/api/sync/e2ee/state")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "mode": "device-key",
                    "keyVersion": 1,
                    "kcv": kcv_b64,
                    "enrolledAt": "2026-11-01T12:00:00Z"
                })
                .to_string(),
            )
            .create_async()
            .await;

        // Requester generates keypair
        let (req_secret, req_pub) = crate::sync::e2ee::pairing::generate_keypair();
        // Approver seals the seed
        let (sealed_b64, app_pub) =
            crate::sync::e2ee::pairing::seal_seed_for_pairing(&seed, &req_pub).unwrap();
        let app_pub_b64 = B64.encode(app_pub);

        // Mock poll approved
        let _m_poll = server
            .mock("GET", "/api/sync/e2ee/pairings/pair-test-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "status": "approved",
                    "sealedSeed": sealed_b64,
                    "approverPublicKey": app_pub_b64
                })
                .to_string(),
            )
            .create_async()
            .await;

        let pairing_store = PairingSessionStore::new();
        pairing_store.insert_request("pair-test-1".into(), req_secret, req_pub);

        let api = ApiClient::with_base(server.url());
        let keystore = InMemoryKeyStore::new();
        let data_store = create_test_store();

        // 1. Poll pairing: returns awaiting-confirmation
        let poll_res = pairing_poll_inner("pair-test-1", "tok", &api, &pairing_store)
            .await
            .unwrap();
        assert_eq!(poll_res.status, "awaiting-confirmation");
        assert!(poll_res.confirmation_words.is_some());

        // INVARIANT 1: seed is NOT in keystore before confirm!
        assert!(
            keystore
                .read_slot(crate::sync::e2ee::service::KEYCHAIN_SLOT)
                .unwrap()
                .is_none(),
            "keystore must NOT have seed before confirm"
        );

        // INVARIANT 2: polling again while awaiting-confirmation is idempotent
        let poll_res_2 = pairing_poll_inner("pair-test-1", "tok", &api, &pairing_store)
            .await
            .unwrap();
        assert_eq!(poll_res_2.status, "awaiting-confirmation");
        assert_eq!(poll_res_2.confirmation_words, poll_res.confirmation_words);

        // 2. Reject leaves keystore untouched
        let _m_cancel = server
            .mock("DELETE", "/api/sync/e2ee/pairings/pair-test-1")
            .with_status(200)
            .with_body(r#"{"status":"cancelled"}"#)
            .create_async()
            .await;

        pairing_reject_inner("pair-test-1", "tok", &api, &pairing_store)
            .await
            .unwrap();

        // INVARIANT 3: reject leaves keystore untouched and session discarded
        assert!(keystore
            .read_slot(crate::sync::e2ee::service::KEYCHAIN_SLOT)
            .unwrap()
            .is_none());
        assert!(pairing_store.get("pair-test-1").is_none());

        // 3. Confirm flow with fresh session
        let (req_secret2, req_pub2) = crate::sync::e2ee::pairing::generate_keypair();
        let (sealed_b64_2, app_pub2) =
            crate::sync::e2ee::pairing::seal_seed_for_pairing(&seed, &req_pub2).unwrap();
        let app_pub_b64_2 = B64.encode(app_pub2);

        let _m_poll2 = server
            .mock("GET", "/api/sync/e2ee/pairings/pair-test-2")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "status": "approved",
                    "sealedSeed": sealed_b64_2,
                    "approverPublicKey": app_pub_b64_2
                })
                .to_string(),
            )
            .create_async()
            .await;

        pairing_store.insert_request("pair-test-2".into(), req_secret2, req_pub2);
        let poll2 = pairing_poll_inner("pair-test-2", "tok", &api, &pairing_store)
            .await
            .unwrap();
        assert_eq!(poll2.status, "awaiting-confirmation");

        // Confirm
        pairing_confirm_inner(
            "pair-test-2",
            "tok",
            &api,
            &keystore,
            &data_store,
            &pairing_store,
        )
        .await
        .unwrap();

        // INVARIANT 4: confirm writes seed to keystore
        let stored_seed = keystore
            .read_slot(crate::sync::e2ee::service::KEYCHAIN_SLOT)
            .unwrap()
            .expect("seed must be in keystore after confirm");
        assert_eq!(stored_seed.as_slice(), &seed);

        // INVARIANT 5: confirm drops session
        assert!(pairing_store.get("pair-test-2").is_none());

        // INVARIANT 6: mirror persisted in data_store
        let conn = data_store.conn().unwrap();
        let mirror = crate::storage::cloud_sync_e2ee_local::get(&conn)
            .unwrap()
            .expect("mirror must exist");
        assert!(mirror.enrolled);
        assert_eq!(mirror.mode, "device-key");
    }

    #[tokio::test]
    async fn test_pairing_approve_matching_words_success() {
        use crate::crypto::keystore::InMemoryKeyStore;

        let mut server = mockito::Server::new_async().await;
        let seed = [42u8; 32];
        let keystore = InMemoryKeyStore::new();
        keystore
            .write_slot(crate::sync::e2ee::service::KEYCHAIN_SLOT, &seed)
            .unwrap();

        let (_req_secret, req_pub) = crate::sync::e2ee::pairing::generate_keypair();
        let req_pub_b64 = B64.encode(req_pub);
        let fp = crate::sync::e2ee::pairing::compute_pairing_fingerprint(&req_pub);

        let _m_list = server
            .mock("GET", "/api/sync/e2ee/pairings")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!([{
                    "id": "pair-app-1",
                    "deviceName": "Laptop",
                    "devicePublicKey": req_pub_b64,
                    "createdAt": "2026-11-01T12:00:00Z",
                    "expiresAt": "2026-11-01T12:10:00Z"
                }])
                .to_string(),
            )
            .create_async()
            .await;

        let m_approve = server
            .mock("POST", "/api/sync/e2ee/pairings/pair-app-1/approve")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"status":"approved"}"#)
            .create_async()
            .await;

        let api = ApiClient::with_base(server.url());

        // Test with uppercase and extra whitespace to verify normalization
        let fp_input = format!("  {}  ", fp.to_uppercase());
        let res = pairing_approve_inner("pair-app-1", &fp_input, "tok", &api, &keystore)
            .await
            .unwrap();

        m_approve.assert_async().await;
        assert!(!res.confirmation_words.is_empty());
    }

    #[tokio::test]
    async fn test_pairing_approve_mismatched_words_refused_no_post() {
        use crate::crypto::keystore::InMemoryKeyStore;

        let mut server = mockito::Server::new_async().await;
        let seed = [42u8; 32];
        let keystore = InMemoryKeyStore::new();
        keystore
            .write_slot(crate::sync::e2ee::service::KEYCHAIN_SLOT, &seed)
            .unwrap();

        let (_req_secret, req_pub) = crate::sync::e2ee::pairing::generate_keypair();
        let req_pub_b64 = B64.encode(req_pub);

        let _m_list = server
            .mock("GET", "/api/sync/e2ee/pairings")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!([{
                    "id": "pair-app-2",
                    "deviceName": "Laptop",
                    "devicePublicKey": req_pub_b64,
                    "createdAt": "2026-11-01T12:00:00Z",
                    "expiresAt": "2026-11-01T12:10:00Z"
                }])
                .to_string(),
            )
            .create_async()
            .await;

        let m_approve = server
            .mock("POST", "/api/sync/e2ee/pairings/pair-app-2/approve")
            .with_status(200)
            .expect(0)
            .create_async()
            .await;

        let api = ApiClient::with_base(server.url());

        let res = pairing_approve_inner(
            "pair-app-2",
            "wrong words totally different words here",
            "tok",
            &api,
            &keystore,
        )
        .await;

        assert!(matches!(res, Err(AppError::SyncPairingFingerprintMismatch)));
        m_approve.assert_async().await;
    }

    #[tokio::test]
    async fn test_pairing_approve_swapped_key_refused_no_post() {
        use crate::crypto::keystore::InMemoryKeyStore;

        let mut server = mockito::Server::new_async().await;
        let seed = [42u8; 32];
        let keystore = InMemoryKeyStore::new();
        keystore
            .write_slot(crate::sync::e2ee::service::KEYCHAIN_SLOT, &seed)
            .unwrap();

        let (_req_secret_1, req_pub_1) = crate::sync::e2ee::pairing::generate_keypair();
        let fp_1 = crate::sync::e2ee::pairing::compute_pairing_fingerprint(&req_pub_1);

        // Server originally showed key 1 to user (fp_1), but when approver fetches list, server returns key 2!
        let (_req_secret_2, req_pub_2) = crate::sync::e2ee::pairing::generate_keypair();
        let req_pub_2_b64 = B64.encode(req_pub_2);

        let _m_list = server
            .mock("GET", "/api/sync/e2ee/pairings")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!([{
                    "id": "pair-app-3",
                    "deviceName": "Laptop",
                    "devicePublicKey": req_pub_2_b64,
                    "createdAt": "2026-11-01T12:00:00Z",
                    "expiresAt": "2026-11-01T12:10:00Z"
                }])
                .to_string(),
            )
            .create_async()
            .await;

        let m_approve = server
            .mock("POST", "/api/sync/e2ee/pairings/pair-app-3/approve")
            .with_status(200)
            .expect(0)
            .create_async()
            .await;

        let api = ApiClient::with_base(server.url());

        // Approver passes fp_1 (the words that were shown to the user)
        let res = pairing_approve_inner("pair-app-3", &fp_1, "tok", &api, &keystore).await;

        assert!(matches!(res, Err(AppError::SyncPairingFingerprintMismatch)));
        m_approve.assert_async().await;
    }

    #[tokio::test]
    async fn test_pairing_incoming_computes_fingerprint_from_server_key() {
        let mut server = mockito::Server::new_async().await;
        let (_req_secret, req_pub) = crate::sync::e2ee::pairing::generate_keypair();
        let req_pub_b64 = B64.encode(req_pub);
        let expected_fp = crate::sync::e2ee::pairing::compute_pairing_fingerprint(&req_pub);

        let _m_list = server
            .mock("GET", "/api/sync/e2ee/pairings")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!([{
                    "id": "pair-inc-1",
                    "deviceName": "Alice's Phone",
                    "devicePublicKey": req_pub_b64,
                    "createdAt": "2026-11-01T12:00:00Z",
                    "expiresAt": "2026-11-01T12:10:00Z"
                }])
                .to_string(),
            )
            .create_async()
            .await;

        let api = ApiClient::with_base(server.url());
        let items = pairing_incoming_inner("tok", &api).await.unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "pair-inc-1");
        assert_eq!(items[0].device_name, "Alice's Phone");
        assert_eq!(items[0].fingerprint, expected_fp);
        assert_eq!(items[0].created_at, "2026-11-01T12:00:00Z");
        assert_eq!(items[0].expires_at, "2026-11-01T12:10:00Z");
    }
}
