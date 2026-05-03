//! Tauri commands for the at-rest encryption layer.
//!
//! Read-only status surface for the privacy settings UI plus
//! IPC-callable encrypt/decrypt for content that lives outside the
//! SQLite storage boundary (currently the `tauri-plugin-store`-backed
//! AI conversation history). The master key never crosses the IPC
//! boundary — the host holds it, callers send plaintext and get
//! ciphertext (or vice versa).

use crate::crypto::{cipher, keystore::KeystoreState};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionStatus {
    /// `'active'` when the master key is OS-keychain backed,
    /// `'fallback'` when running on a Linux file-backed key (no
    /// Secret Service available). The fatal case never reaches this
    /// command — startup aborts before the state is managed.
    pub status: &'static str,
    pub is_os_backed: bool,
}

#[tauri::command]
pub async fn crypto_get_status(
    keystore: State<'_, KeystoreState>,
) -> Result<EncryptionStatus, AppError> {
    Ok(status_inner(&keystore))
}

#[tauri::command]
pub async fn crypto_encrypt(
    plaintext: String,
    keystore: State<'_, KeystoreState>,
) -> Result<String, AppError> {
    cipher::encrypt(&plaintext, keystore.master_key())
}

#[tauri::command]
pub async fn crypto_decrypt(
    value: String,
    keystore: State<'_, KeystoreState>,
) -> Result<String, AppError> {
    cipher::decrypt(&value, keystore.master_key())
}

pub(crate) fn status_inner(keystore: &KeystoreState) -> EncryptionStatus {
    EncryptionStatus {
        status: if keystore.is_os_backed() {
            "active"
        } else {
            "fallback"
        },
        is_os_backed: keystore.is_os_backed(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keystore::{InMemoryKeyStore, KeystoreState};

    #[test]
    fn status_inner_reports_fallback_for_non_os_backed() {
        let store = InMemoryKeyStore::new();
        let state = KeystoreState::from_keystore(&store).unwrap();
        let s = status_inner(&state);
        assert_eq!(s.status, "fallback");
        assert!(!s.is_os_backed);
    }
}
