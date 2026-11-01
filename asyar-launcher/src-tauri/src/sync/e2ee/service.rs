//! High-level orchestration for E2EE enrolment, unlock, rotation,
//! recovery, disable, and recovery-phrase display. This module owns
//! the keychain slot lifecycle and the local mirror.
//!
//! Composition pattern: `E2eeService` holds borrowed references to
//! the `ApiClient`, the `KeyStore`, and the `DataStore`, plus the
//! auth token threaded in by the Tauri command layer. Each method
//! does one user-facing operation.

use crate::auth::api_client::ApiClient;
use crate::crypto::{cipher, kdf, keystore::KeyStore, mnemonic};
use crate::error::AppError;
use crate::storage::cloud_sync_e2ee_local::{self, E2eeLocalState};
use crate::storage::DataStore;
use crate::sync::e2ee::mode::Mode;
use crate::sync::types::E2eeStatePayload;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::atomic::{AtomicU64, Ordering};
use zeroize::Zeroizing;

fn current_unix_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn current_unix_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

static LAST_RECONCILIATION_UNIX_SECS: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
pub fn reset_last_reconciliation_for_tests() {
    LAST_RECONCILIATION_UNIX_SECS.store(0, Ordering::SeqCst);
}

#[cfg(test)]
pub fn set_last_reconciliation_for_tests(secs: u64) {
    LAST_RECONCILIATION_UNIX_SECS.store(secs, Ordering::SeqCst);
}

/// Keychain slot for the cached master_seed. Distinct from the
/// Layer 3 `data-encryption-v1` slot so the two can coexist.
pub const KEYCHAIN_SLOT: &str = "sync-master-seed-v1";

pub struct E2eeService<'a> {
    pub api: &'a ApiClient,
    pub keystore: &'a dyn KeyStore,
    pub data_store: &'a DataStore,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrolmentResult {
    /// 24 BIP-39 words separated by single spaces.
    pub recovery_phrase: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct E2eeStatusReport {
    pub enabled: bool,
    /// Enrolled but no cached master_seed (e.g. fresh second-device install).
    pub locked: bool,
    pub key_version: Option<u64>,
    pub mode: Option<String>,
    pub keystore_is_os_backed: bool,
    pub finalize_pending: bool,
}

impl<'a> E2eeService<'a> {
    /// Compute the current sync mode by reading the keychain + local mirror.
    /// Returns `Mode::Off` if disabled, `Mode::Locked` if enrolled but locked,
    /// or `Mode::On` with the cached seed.
    pub fn load_mode(&self) -> Result<Mode, AppError> {
        let conn = self.data_store.conn()?;
        let local = cloud_sync_e2ee_local::get(&conn)?;
        match local {
            None => Ok(Mode::Off),
            Some(state) if !state.enrolled => Ok(Mode::Off),
            Some(state) => match self.keystore.read_slot(KEYCHAIN_SLOT)? {
                None => Ok(Mode::Locked), // enrolled but locked
                Some(seed_bytes) => {
                    if seed_bytes.len() != 32 {
                        return Err(AppError::Encryption(
                            "cached master_seed wrong length".into(),
                        ));
                    }
                    let mut seed = Zeroizing::new([0u8; 32]);
                    seed.copy_from_slice(&seed_bytes);
                    if let Some(ref expected_kcv) = state.kcv {
                        if !crate::sync::e2ee::pairing::verify_kcv(&seed, expected_kcv) {
                            log::warn!(
                                "[e2ee] cached master_seed does not match mirror KCV; locked"
                            );
                            return Ok(Mode::Locked);
                        }
                    }
                    Ok(Mode::On {
                        master_seed: seed,
                        key_version: state.key_version as u64,
                    })
                }
            },
        }
    }

    pub fn status(&self) -> Result<E2eeStatusReport, AppError> {
        let conn = self.data_store.conn()?;
        let local = cloud_sync_e2ee_local::get(&conn)?;
        let cached = self.keystore.read_slot(KEYCHAIN_SLOT)?.is_some();
        let os_backed = self.keystore.is_os_backed();
        Ok(match local {
            None => E2eeStatusReport {
                enabled: false,
                locked: false,
                key_version: None,
                mode: None,
                keystore_is_os_backed: os_backed,
                finalize_pending: false,
            },
            Some(s) => E2eeStatusReport {
                enabled: s.enrolled,
                locked: s.enrolled && !cached,
                key_version: Some(s.key_version as u64),
                mode: Some(s.mode.clone()),
                keystore_is_os_backed: os_backed,
                finalize_pending: s.finalize_pending,
            },
        })
    }

    /// Ensure the local mirror exists, fetching from server if missing.
    ///
    /// Returns current Mode:
    /// - `Mode::Off` if genuinely not enrolled (server 404 and no mirror)
    /// - `Mode::Locked` if enrolled on server/locally but seed not in keystore
    /// - `Mode::On` if enrolled and seed present in keystore
    ///
    /// Transient errors (server unreachable while mirror is absent) return `AppError::SyncServerUnavailable`.
    pub async fn ensure_mirror_and_load_mode(&self, token: &str) -> Result<Mode, AppError> {
        let conn = self.data_store.conn()?;
        let local = cloud_sync_e2ee_local::get(&conn)?;
        if local.is_none() {
            match self.api.get_e2ee_state(token).await {
                Ok(Some(remote)) => {
                    let kcv_bytes = remote.kcv.as_deref().and_then(|s| B64.decode(s).ok());
                    let mode_str = remote.mode.as_deref().unwrap_or("passphrase");
                    let finalize_pending = remote.plaintext_rows.unwrap_or(0) > 0;
                    cloud_sync_e2ee_local::upsert(
                        &conn,
                        &cloud_sync_e2ee_local::E2eeLocalState {
                            enrolled: true,
                            key_version: remote.key_version as i64,
                            wrapped_master_seed: remote.wrapped_master_seed,
                            kdf_salt: remote.kdf_salt.and_then(|s| B64.decode(s).ok()),
                            kdf_m_cost: remote.kdf_m_cost.map(|c| c as i64),
                            kdf_t_cost: remote.kdf_t_cost.map(|c| c as i64),
                            kdf_p_cost: remote.kdf_p_cost.map(|c| c as i64),
                            updated_at_ms: current_unix_ms(),
                            mode: mode_str.to_string(),
                            kcv: kcv_bytes,
                            finalize_pending,
                        },
                    )?;
                }
                Ok(None) => {
                    return Ok(Mode::Off);
                }
                Err(AppError::Auth(msg)) => {
                    return Err(AppError::Auth(msg));
                }
                Err(e) => {
                    log::warn!("[sync] failed to check remote e2ee state: {e:?}");
                    return Err(AppError::SyncServerUnavailable(format!(
                        "cannot verify E2EE state: {e}"
                    )));
                }
            }
        }
        self.load_mode()
    }

    /// Reconcile local mirror with remote E2EE state, once per app session and at most every 24 hours.
    ///
    /// Only runs when a local mirror already exists and the account is enrolled.
    pub async fn reconcile_server_state_if_due(
        &self,
        token: &str,
    ) -> Result<Option<Mode>, AppError> {
        let now = current_unix_secs();
        let last = LAST_RECONCILIATION_UNIX_SECS.load(Ordering::SeqCst);
        let is_due = last == 0 || now.saturating_sub(last) >= 86_400;
        if !is_due {
            return Ok(None);
        }

        let res = self.reconcile_server_state(token).await;
        if res.is_ok() {
            LAST_RECONCILIATION_UNIX_SECS.store(now, Ordering::SeqCst);
        }
        res
    }

    /// Perform server-state reconciliation unconditionally (if local mirror is enrolled):
    /// - (a) If `plaintextRows > 0`, sets `finalize_pending = true`.
    /// - (b) If server says 404 not-enrolled while mirror is enrolled, clears mirror, deletes keystore slot, marks all rows dirty, and returns `Ok(Some(Mode::Off))` so auto-enrol can run.
    /// - (c) If server `kcv` or `mode` differs from mirror, updates mirror, deletes keystore slot, and returns `Ok(Some(Mode::Locked))`.
    ///
    /// Transient errors (network down, 5xx) are caught non-fatally and return `Ok(None)`.
    pub async fn reconcile_server_state(&self, token: &str) -> Result<Option<Mode>, AppError> {
        let conn = self.data_store.conn()?;
        let local = cloud_sync_e2ee_local::get(&conn)?;
        let Some(local_state) = local else {
            return Ok(None);
        };
        if !local_state.enrolled {
            return Ok(None);
        }

        let remote_opt = match self.api.get_e2ee_state(token).await {
            Ok(opt) => opt,
            Err(AppError::Auth(msg)) => return Err(AppError::Auth(msg)),
            Err(e) => {
                log::warn!("[e2ee] server-state reconciliation transient error: {e}");
                return Ok(None);
            }
        };

        // (b) Server returned 404 not-enrolled while mirror was enrolled
        let Some(remote) = remote_opt else {
            log::info!("[e2ee] reconciliation: server returned 404 not-enrolled while mirror was enrolled; resetting local mirror");
            cloud_sync_e2ee_local::clear(&conn)?;
            let _ = self.keystore.delete_slot(KEYCHAIN_SLOT);
            crate::storage::cloud_sync_state::mark_all_dirty(&conn)?;
            return Ok(Some(Mode::Off));
        };

        let remote_mode = remote.mode.as_deref().unwrap_or("passphrase");
        let remote_kcv = remote.kcv.as_deref().and_then(|s| B64.decode(s).ok());
        let mode_changed = local_state.mode != remote_mode;
        let kcv_changed = local_state.kcv != remote_kcv;

        // (c) Server kcv or mode differs from mirror
        if mode_changed || kcv_changed {
            log::info!(
                "[e2ee] reconciliation: server state changed (mode_changed={mode_changed}, kcv_changed={kcv_changed}); updating mirror and locking"
            );
            cloud_sync_e2ee_local::upsert(
                &conn,
                &cloud_sync_e2ee_local::E2eeLocalState {
                    enrolled: true,
                    key_version: remote.key_version as i64,
                    wrapped_master_seed: remote.wrapped_master_seed,
                    kdf_salt: remote.kdf_salt.and_then(|s| B64.decode(s).ok()),
                    kdf_m_cost: remote.kdf_m_cost.map(|c| c as i64),
                    kdf_t_cost: remote.kdf_t_cost.map(|c| c as i64),
                    kdf_p_cost: remote.kdf_p_cost.map(|c| c as i64),
                    updated_at_ms: current_unix_ms(),
                    mode: remote_mode.to_string(),
                    kcv: remote_kcv,
                    finalize_pending: remote.plaintext_rows.unwrap_or(0) > 0,
                },
            )?;
            let _ = self.keystore.delete_slot(KEYCHAIN_SLOT);
            return Ok(Some(Mode::Locked));
        }

        // (a) Plaintext rows need finalization
        if remote.plaintext_rows.unwrap_or(0) > 0 && !local_state.finalize_pending {
            log::info!(
                "[e2ee] reconciliation: plaintextRows > 0 detected; setting finalize_pending"
            );
            cloud_sync_e2ee_local::set_finalize_pending(&conn, true)?;
        }

        Ok(None)
    }

    /// Generate fresh master_seed, derive wrap_key, wrap, POST to server,
    /// cache locally, return the 24-word recovery phrase.
    pub async fn enrol(&self, token: &str, passphrase: &str) -> Result<EnrolmentResult, AppError> {
        let seed = Zeroizing::new(rand::random::<[u8; 32]>());
        let salt: [u8; 32] = rand::random();

        let wrap_key = kdf::derive_wrap_key(
            passphrase,
            &salt,
            kdf::ARGON2_M_COST,
            kdf::ARGON2_T_COST,
            kdf::ARGON2_P_COST,
        )?;
        let wrapped = cipher::encrypt(&B64.encode(*seed), &wrap_key)?;

        let payload = E2eeStatePayload::passphrase(
            wrapped,
            B64.encode(salt),
            "argon2id".into(),
            kdf::ARGON2_M_COST,
            kdf::ARGON2_T_COST,
            kdf::ARGON2_P_COST,
        );
        let resp = self.api.post_e2ee_state(token, &payload).await?;

        self.apply_local_state_after_enrol(&seed, &payload, &salt, resp.key_version)?;

        let phrase = mnemonic::encode(&seed)?;
        Ok(EnrolmentResult {
            recovery_phrase: phrase,
        })
    }

    /// Trial-decrypt the wrapped seed with the typed passphrase. On
    /// success, cache the master_seed in the keychain.
    pub async fn unlock(&self, _token: &str, passphrase: &str) -> Result<(), AppError> {
        let conn = self.data_store.conn()?;
        let local = cloud_sync_e2ee_local::get(&conn)?
            .ok_or_else(|| AppError::Validation("not enrolled".into()))?;
        if local.mode != "passphrase" {
            return Err(AppError::SyncE2eeWrongMode(
                "account is in device-key mode; use recovery phrase or approval to unlock".into(),
            ));
        }
        let wrapped_seed = local
            .wrapped_master_seed
            .as_ref()
            .ok_or_else(|| AppError::Validation("missing wrapped seed".into()))?;
        let kdf_salt = local
            .kdf_salt
            .as_ref()
            .ok_or_else(|| AppError::Validation("missing kdf salt".into()))?;
        let m_cost = local
            .kdf_m_cost
            .ok_or_else(|| AppError::Validation("missing kdf m_cost".into()))?
            as u32;
        let t_cost = local
            .kdf_t_cost
            .ok_or_else(|| AppError::Validation("missing kdf t_cost".into()))?
            as u32;
        let p_cost = local
            .kdf_p_cost
            .ok_or_else(|| AppError::Validation("missing kdf p_cost".into()))?
            as u32;

        let wrap_key = kdf::derive_wrap_key(passphrase, kdf_salt, m_cost, t_cost, p_cost)?;
        let seed_b64 = cipher::decrypt(wrapped_seed, &wrap_key)
            .map_err(|_| AppError::Validation("incorrect passphrase".into()))?;
        let seed_bytes = B64
            .decode(seed_b64.as_bytes())
            .map_err(|e| AppError::Encryption(format!("decode seed: {e}")))?;
        if seed_bytes.len() != 32 {
            return Err(AppError::Encryption("decoded seed wrong length".into()));
        }
        write_slot_with_read_back(self.keystore, KEYCHAIN_SLOT, &seed_bytes)?;
        Ok(())
    }

    pub async fn rotate(&self, token: &str, old: &str, new: &str) -> Result<(), AppError> {
        // Verify old passphrase by trial decrypt + cache the master_seed
        // (this also handles the case where the cache was empty for some reason).
        self.unlock(token, old).await?;

        // Scope the conn guard so it's dropped before the await below.
        let (payload, salt_array) = {
            let conn = self.data_store.conn()?;
            let local = cloud_sync_e2ee_local::get(&conn)?
                .ok_or_else(|| AppError::Validation("not enrolled".into()))?;
            let seed_bytes = self
                .keystore
                .read_slot(KEYCHAIN_SLOT)?
                .ok_or_else(|| AppError::Encryption("master_seed missing".into()))?;

            let new_salt = local
                .kdf_salt
                .as_ref()
                .ok_or_else(|| AppError::Validation("missing kdf salt".into()))?
                .clone();
            let m_cost = local
                .kdf_m_cost
                .ok_or_else(|| AppError::Validation("missing kdf m_cost".into()))?
                as u32;
            let t_cost = local
                .kdf_t_cost
                .ok_or_else(|| AppError::Validation("missing kdf t_cost".into()))?
                as u32;
            let p_cost = local
                .kdf_p_cost
                .ok_or_else(|| AppError::Validation("missing kdf p_cost".into()))?
                as u32;
            let new_wrap_key = kdf::derive_wrap_key(new, &new_salt, m_cost, t_cost, p_cost)?;
            let new_wrapped = cipher::encrypt(&B64.encode(&*seed_bytes), &new_wrap_key)?;

            let salt_array: [u8; 32] = new_salt
                .as_slice()
                .try_into()
                .map_err(|_| AppError::Encryption("kdf_salt wrong length".into()))?;

            let payload = E2eeStatePayload::passphrase(
                new_wrapped,
                B64.encode(salt_array),
                "argon2id".into(),
                m_cost,
                t_cost,
                p_cost,
            );
            (payload, salt_array)
        }; // conn guard dropped here

        let resp = self.api.put_e2ee_state(token, &payload).await?;
        self.persist_local(&payload, &salt_array, resp.key_version)?;
        Ok(())
    }

    /// Decode the 24-word recovery phrase, optionally trial-decrypt one
    /// server item to confirm ownership, then re-wrap the seed under the
    /// new passphrase and PUT.
    pub async fn recover_with_mnemonic(
        &self,
        token: &str,
        phrase: &str,
        new_passphrase: &str,
        verify_with_payload: Option<&str>,
    ) -> Result<(), AppError> {
        let recovered_seed = mnemonic::decode(phrase)?;

        if let Some(ct) = verify_with_payload {
            crate::crypto::sync_envelope::decrypt_payload(ct, &recovered_seed).map_err(|_| {
                AppError::Validation("recovery phrase doesn't match your account".into())
            })?;
        }

        let salt: [u8; 32] = rand::random();
        let wrap_key = kdf::derive_wrap_key(
            new_passphrase,
            &salt,
            kdf::ARGON2_M_COST,
            kdf::ARGON2_T_COST,
            kdf::ARGON2_P_COST,
        )?;
        let wrapped = cipher::encrypt(&B64.encode(*recovered_seed), &wrap_key)?;
        let payload = E2eeStatePayload::passphrase(
            wrapped,
            B64.encode(salt),
            "argon2id".into(),
            kdf::ARGON2_M_COST,
            kdf::ARGON2_T_COST,
            kdf::ARGON2_P_COST,
        );
        let resp = self.api.put_e2ee_state(token, &payload).await?;
        self.keystore.write_slot(KEYCHAIN_SLOT, &*recovered_seed)?;
        self.persist_local(&payload, &salt, resp.key_version)?;
        Ok(())
    }

    pub async fn auto_enrol(&self, token: &str) -> Result<(), AppError> {
        let mut seed = Zeroizing::new([0u8; 32]);
        match self.keystore.read_slot(KEYCHAIN_SLOT)? {
            Some(bytes) if bytes.len() == 32 => {
                seed.copy_from_slice(&bytes);
            }
            _ => {
                rand::fill(&mut *seed);
                write_slot_with_read_back(self.keystore, KEYCHAIN_SLOT, &*seed)?;
            }
        }

        let kcv = crate::sync::e2ee::pairing::compute_kcv(&seed);
        let kcv_b64 = B64.encode(kcv);

        let resp = match self.api.post_e2ee_device_key(token, &kcv_b64).await {
            Ok(resp) => resp,
            Err(AppError::SyncE2eeAlreadyEnrolled) => {
                let _ = self.keystore.delete_slot(KEYCHAIN_SLOT);
                if let Ok(Some(remote)) = self.api.get_e2ee_state(token).await {
                    let conn = self.data_store.conn()?;
                    let kcv_bytes = remote.kcv.as_deref().and_then(|s| B64.decode(s).ok());
                    let mode_str = remote.mode.as_deref().unwrap_or("device-key");
                    let _ = cloud_sync_e2ee_local::upsert(
                        &conn,
                        &cloud_sync_e2ee_local::E2eeLocalState {
                            enrolled: true,
                            key_version: remote.key_version as i64,
                            wrapped_master_seed: remote.wrapped_master_seed,
                            kdf_salt: remote.kdf_salt.and_then(|s| B64.decode(s).ok()),
                            kdf_m_cost: remote.kdf_m_cost.map(|c| c as i64),
                            kdf_t_cost: remote.kdf_t_cost.map(|c| c as i64),
                            kdf_p_cost: remote.kdf_p_cost.map(|c| c as i64),
                            updated_at_ms: current_unix_ms(),
                            mode: mode_str.to_string(),
                            kcv: kcv_bytes,
                            finalize_pending: remote.plaintext_rows.unwrap_or(0) > 0,
                        },
                    );
                }
                return Err(AppError::SyncE2eeLocked);
            }
            Err(e @ (AppError::Network(_) | AppError::Other(_))) => {
                // Ambiguous network/server error: the server may have committed the enrolment.
                // Reconcile against remote state before deleting the seed.
                match self.api.get_e2ee_state(token).await {
                    Ok(Some(remote)) if remote.kcv.as_deref() == Some(kcv_b64.as_str()) => remote,
                    Ok(Some(remote)) => {
                        let _ = self.keystore.delete_slot(KEYCHAIN_SLOT);
                        let conn = self.data_store.conn()?;
                        let kcv_bytes = remote.kcv.as_deref().and_then(|s| B64.decode(s).ok());
                        let mode_str = remote.mode.as_deref().unwrap_or("device-key");
                        let _ = cloud_sync_e2ee_local::upsert(
                            &conn,
                            &cloud_sync_e2ee_local::E2eeLocalState {
                                enrolled: true,
                                key_version: remote.key_version as i64,
                                wrapped_master_seed: remote.wrapped_master_seed,
                                kdf_salt: remote.kdf_salt.and_then(|s| B64.decode(s).ok()),
                                kdf_m_cost: remote.kdf_m_cost.map(|c| c as i64),
                                kdf_t_cost: remote.kdf_t_cost.map(|c| c as i64),
                                kdf_p_cost: remote.kdf_p_cost.map(|c| c as i64),
                                updated_at_ms: current_unix_ms(),
                                mode: mode_str.to_string(),
                                kcv: kcv_bytes,
                                finalize_pending: remote.plaintext_rows.unwrap_or(0) > 0,
                            },
                        );
                        return Err(AppError::SyncE2eeLocked);
                    }
                    Ok(None) => {
                        let _ = self.keystore.delete_slot(KEYCHAIN_SLOT);
                        return Err(e);
                    }
                    Err(_) => {
                        // Remote state check also unreachable; retain the seed so next sync can reconcile.
                        return Err(e);
                    }
                }
            }
            Err(e) => {
                let _ = self.keystore.delete_slot(KEYCHAIN_SLOT);
                return Err(e);
            }
        };

        let conn = self.data_store.conn()?;
        cloud_sync_e2ee_local::upsert(
            &conn,
            &cloud_sync_e2ee_local::E2eeLocalState {
                enrolled: true,
                key_version: resp.key_version as i64,
                wrapped_master_seed: None,
                kdf_salt: None,
                kdf_m_cost: None,
                kdf_t_cost: None,
                kdf_p_cost: None,
                updated_at_ms: current_unix_ms(),
                mode: "device-key".into(),
                kcv: Some(kcv.to_vec()),
                finalize_pending: true,
            },
        )?;
        let n = crate::storage::cloud_sync_state::mark_all_dirty(&conn)?;
        log::info!(
            "[e2ee] auto_enrol complete: marked {n} rows dirty for initial ciphertext upload"
        );
        Ok(())
    }

    pub async fn finalize_if_pending(
        &self,
        token: &str,
        pulled_through_version: i64,
    ) -> Result<(), AppError> {
        let conn = self.data_store.conn()?;
        let local = cloud_sync_e2ee_local::get(&conn)?;
        let Some(state) = local else {
            return Ok(());
        };
        if !state.enrolled || !state.finalize_pending {
            return Ok(());
        }
        match self.api.finalize_e2ee(token, pulled_through_version).await {
            Ok(resp) => {
                log::info!(
                    "[e2ee] finalized: deleted {} plaintext rows",
                    resp.deleted_rows
                );
                cloud_sync_e2ee_local::set_finalize_pending(&conn, false)?;
            }
            Err(AppError::SyncFinalizeBehind {
                plaintext_max_version,
            }) => {
                log::info!(
                    "[e2ee] finalize-behind (plaintext max version {}); retaining finalize_pending",
                    plaintext_max_version
                );
            }
            Err(e) => {
                log::warn!("[e2ee] finalize call failed: {e:?}; retaining finalize_pending");
            }
        }
        Ok(())
    }

    pub fn unlock_with_recovery_phrase(&self, phrase: &str) -> Result<(), AppError> {
        let recovered_seed = mnemonic::decode(phrase)?;
        let conn = self.data_store.conn()?;
        let local =
            cloud_sync_e2ee_local::get(&conn)?.ok_or_else(|| AppError::SyncE2eeNotEnrolled)?;
        if local.mode != "device-key" {
            return Err(AppError::SyncE2eeWrongMode(
                "account is in passphrase mode; use passphrase to unlock".into(),
            ));
        }
        let Some(expected_kcv) = local.kcv.as_ref() else {
            return Err(AppError::Validation("missing KCV in local mirror".into()));
        };
        if expected_kcv.len() != 32 {
            return Err(AppError::Validation("corrupt KCV in local mirror".into()));
        }
        let mut expected = [0u8; 32];
        expected.copy_from_slice(expected_kcv);

        if !crate::sync::e2ee::pairing::verify_kcv(&recovered_seed, &expected) {
            return Err(AppError::Validation(
                "recovery phrase doesn't match this account".into(),
            ));
        }

        write_slot_with_read_back(self.keystore, KEYCHAIN_SLOT, &*recovered_seed)?;
        Ok(())
    }

    pub fn show_recovery_phrase_device_key(&self) -> Result<String, AppError> {
        let conn = self.data_store.conn()?;
        let local =
            cloud_sync_e2ee_local::get(&conn)?.ok_or_else(|| AppError::SyncE2eeNotEnrolled)?;
        if local.mode != "device-key" {
            return Err(AppError::SyncE2eeWrongMode(
                "account is in passphrase mode; use show_recovery_phrase with passphrase".into(),
            ));
        }
        let seed_bytes = self
            .keystore
            .read_slot(KEYCHAIN_SLOT)?
            .ok_or_else(|| AppError::SyncE2eeLocked)?;
        if seed_bytes.len() != 32 {
            return Err(AppError::Encryption(
                "cached master_seed wrong length".into(),
            ));
        }
        let mut seed = Zeroizing::new([0u8; 32]);
        seed.copy_from_slice(&seed_bytes);
        mnemonic::encode(&seed)
    }

    pub async fn reset(&self, token: &str) -> Result<crate::sync::types::ResetResponse, AppError> {
        let resp = self.api.reset_sync(token).await?;
        let _ = self.keystore.delete_slot(KEYCHAIN_SLOT);
        let conn = self.data_store.conn()?;
        cloud_sync_e2ee_local::clear(&conn)?;
        crate::storage::cloud_sync_state::mark_all_dirty(&conn)?;
        Ok(resp)
    }

    pub async fn disable(&self, token: &str) -> Result<(), AppError> {
        let conn = self.data_store.conn()?;
        if let Some(local) = cloud_sync_e2ee_local::get(&conn)? {
            if local.mode == "device-key" {
                return Err(AppError::SyncE2eeWrongMode(
                    "disable is not allowed for device-key accounts; use reset instead".into(),
                ));
            }
        }
        self.api.delete_e2ee_state(token).await?;
        self.apply_local_state_after_disable()?;
        Ok(())
    }

    pub fn show_recovery_phrase(&self, passphrase: &str) -> Result<String, AppError> {
        let conn = self.data_store.conn()?;
        let local = cloud_sync_e2ee_local::get(&conn)?
            .ok_or_else(|| AppError::Validation("not enrolled".into()))?;
        if local.mode != "passphrase" {
            return Err(AppError::SyncE2eeWrongMode(
                "passphrase recovery is only available for passphrase accounts".into(),
            ));
        }

        let wrapped_seed = local
            .wrapped_master_seed
            .as_ref()
            .ok_or_else(|| AppError::Validation("missing wrapped seed".into()))?;
        let kdf_salt = local
            .kdf_salt
            .as_ref()
            .ok_or_else(|| AppError::Validation("missing kdf salt".into()))?;
        let m_cost = local
            .kdf_m_cost
            .ok_or_else(|| AppError::Validation("missing kdf m_cost".into()))?
            as u32;
        let t_cost = local
            .kdf_t_cost
            .ok_or_else(|| AppError::Validation("missing kdf t_cost".into()))?
            as u32;
        let p_cost = local
            .kdf_p_cost
            .ok_or_else(|| AppError::Validation("missing kdf p_cost".into()))?
            as u32;

        // Verify passphrase by trial-decrypting the stored wrapped seed.
        let wrap_key = kdf::derive_wrap_key(passphrase, kdf_salt, m_cost, t_cost, p_cost)?;
        cipher::decrypt(wrapped_seed, &wrap_key)
            .map_err(|_| AppError::Validation("incorrect passphrase".into()))?;

        // Read seed from keychain and BIP-39 encode.
        let seed_bytes = self
            .keystore
            .read_slot(KEYCHAIN_SLOT)?
            .ok_or_else(|| AppError::Encryption("master_seed not cached".into()))?;
        let seed: [u8; 32] = seed_bytes
            .as_slice()
            .try_into()
            .map_err(|_| AppError::Encryption("cached master_seed wrong length".into()))?;
        mnemonic::encode(&seed)
    }

    /// Local-state mutation that runs after a successful `POST /e2ee/state`.
    ///
    /// Cache the master_seed in the keychain, persist the wrapped-seed +
    /// KDF parameters into the local mirror, then mark every journal row
    /// dirty so the next sync push re-uploads each item under the freshly-
    /// minted seed. Without the dirty-mark step, items already on the
    /// server stay in their pre-enrolment plaintext form and only items
    /// dirtied AFTER enrolment get encrypted — the server-side privacy
    /// guarantee would be incomplete.
    ///
    /// Extracted from `enrol()` so the local-state invariants ("seed is
    /// cached", "mirror is written", "every journal row is dirty after
    /// toggle") can be unit-tested without standing up an HTTP mock for
    /// the API call.
    fn apply_local_state_after_enrol(
        &self,
        seed: &[u8; 32],
        payload: &E2eeStatePayload,
        salt: &[u8; 32],
        key_version: u64,
    ) -> Result<(), AppError> {
        self.keystore.write_slot(KEYCHAIN_SLOT, seed)?;
        self.persist_local(payload, salt, key_version)?;
        let conn = self.data_store.conn()?;
        let n = crate::storage::cloud_sync_state::mark_all_dirty(&conn)?;
        log::info!("[e2ee] enrol: marked {n} journal rows dirty for re-upload as ciphertext");
        Ok(())
    }

    /// Local-state mutation that runs after a successful
    /// `DELETE /e2ee/state`.
    ///
    /// Drop the cached master_seed, clear the local mirror, and mark every
    /// journal row dirty so the next sync re-uploads each item as plaintext
    /// now that ciphertext is off. Without the dirty-mark step, the server
    /// keeps its pre-disable ciphertext payloads and the launcher (with no
    /// cached seed) can no longer decrypt them on pull.
    ///
    /// Extracted from `disable()` for the same reason as
    /// [`Self::apply_local_state_after_enrol`] — testability without an
    /// HTTP mock.
    fn apply_local_state_after_disable(&self) -> Result<(), AppError> {
        self.keystore.delete_slot(KEYCHAIN_SLOT)?;
        let conn = self.data_store.conn()?;
        cloud_sync_e2ee_local::clear(&conn)?;
        let n = crate::storage::cloud_sync_state::mark_all_dirty(&conn)?;
        log::info!("[e2ee] disable: marked {n} journal rows dirty for re-upload as plaintext");
        Ok(())
    }

    fn persist_local(
        &self,
        payload: &E2eeStatePayload,
        salt: &[u8; 32],
        key_version: u64,
    ) -> Result<(), AppError> {
        let state = E2eeLocalState {
            enrolled: true,
            key_version: key_version as i64,
            wrapped_master_seed: payload.wrapped_master_seed.clone(),
            kdf_salt: Some(salt.to_vec()),
            kdf_m_cost: payload.kdf_m_cost.map(|c| c as i64),
            kdf_t_cost: payload.kdf_t_cost.map(|c| c as i64),
            kdf_p_cost: payload.kdf_p_cost.map(|c| c as i64),
            updated_at_ms: current_unix_ms(),
            mode: "passphrase".into(),
            kcv: None,
            finalize_pending: false,
        };
        let conn = self.data_store.conn()?;
        cloud_sync_e2ee_local::upsert(&conn, &state)?;
        Ok(())
    }
}

/// Write raw bytes to a keystore slot and immediately read them back,
/// comparing in constant time. On mismatch or read failure, deletes the slot
/// and returns an error, ensuring unreadable secrets are never accepted.
pub fn write_slot_with_read_back(
    keystore: &dyn KeyStore,
    slot: &str,
    secret: &[u8],
) -> Result<(), AppError> {
    keystore.write_slot(slot, secret)?;
    let read_back = keystore.read_slot(slot)?;
    match read_back {
        Some(bytes) if crate::sync::e2ee::pairing::constant_time_eq(&bytes, secret) => Ok(()),
        _ => {
            let _ = keystore.delete_slot(slot);
            Err(AppError::Encryption(
                "keystore write verification failed: read-back did not match".into(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keystore::InMemoryKeyStore;
    use crate::storage::{cloud_sync_state, create_test_store};

    // Most service methods do I/O (HTTP, keychain, SQLite) so are
    // integration-tested via Tauri commands or end-to-end. This module
    // tests just the pure helpers that don't need a full ApiClient mock —
    // including the post-API-success local-state mutators
    // [`E2eeService::apply_local_state_after_enrol`] and
    // [`E2eeService::apply_local_state_after_disable`], extracted from
    // `enrol()` / `disable()` so the journal/keystore/mirror invariants
    // can be verified without standing up an HTTP fake.

    fn dummy_payload() -> E2eeStatePayload {
        E2eeStatePayload::passphrase(
            "enc:v1:dummy".into(),
            B64.encode([7u8; 32]),
            "argon2id".into(),
            kdf::ARGON2_M_COST,
            kdf::ARGON2_T_COST,
            kdf::ARGON2_P_COST,
        )
    }

    fn make_hash(byte: u8) -> Vec<u8> {
        vec![byte; 32]
    }

    fn seed_dirty_journal_row(
        conn: &rusqlite::Connection,
        item_id: &str,
        category_id: &str,
        hash: Option<Vec<u8>>,
    ) {
        cloud_sync_state::upsert_item(
            conn,
            &cloud_sync_state::ItemJournalEntry {
                item_id: item_id.into(),
                category_id: category_id.into(),
                last_uploaded_hash: hash,
                server_version: Some(1),
                is_dirty: false,
                is_tombstone: false,
            },
        )
        .unwrap();
    }

    /// Regression: enrolment must (a) cache the seed in the keystore,
    /// (b) write the local mirror, and (c) mark every journal row dirty
    /// AND clear its `last_uploaded_hash` so the next push actually
    /// re-uploads each item as ciphertext. The original implementation
    /// skipped (c), and a partial fix that only flipped `is_dirty`
    /// silently no-op'd in [`crate::sync::orchestrator::decide_uploads`]
    /// (the plaintext content hash matched the previous upload's hash).
    /// Both halves of (c) are load-bearing.
    #[test]
    fn apply_local_state_after_enrol_caches_seed_writes_mirror_and_force_re_uploads_journal() {
        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let api = ApiClient::new(); // never called by the helper
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        // Seed the journal with a clean row whose hash equals what an
        // unchanged-content push would compute. This is the exact shape
        // that triggered the silent-skip bug.
        let conn = store.conn().unwrap();
        seed_dirty_journal_row(&conn, "item-1", "clipboard", Some(make_hash(0x42)));
        drop(conn);

        let seed: [u8; 32] = rand::random();
        let payload = dummy_payload();
        let salt: [u8; 32] = rand::random();

        svc.apply_local_state_after_enrol(&seed, &payload, &salt, 1)
            .unwrap();

        // (a) seed cached in keystore.
        let cached = keystore.read_slot(KEYCHAIN_SLOT).unwrap().unwrap();
        assert_eq!(*cached, seed.to_vec());

        // (b) local mirror written with enrolled = true.
        let conn = store.conn().unwrap();
        let mirror = cloud_sync_e2ee_local::get(&conn).unwrap().unwrap();
        assert!(mirror.enrolled);
        assert_eq!(mirror.key_version, 1);
        assert_eq!(mirror.kdf_salt.as_deref(), Some(&salt[..]));

        // (c) journal row is dirty AND its hash is cleared. Without
        // either half, the next sync push silently skips this row.
        let dirty = cloud_sync_state::get_dirty(&conn).unwrap();
        let row = dirty
            .iter()
            .find(|e| e.item_id == "item-1")
            .expect("item-1 must be in the dirty list after enrol");
        assert!(row.is_dirty, "row must be dirty after enrol");
        assert_eq!(
            row.last_uploaded_hash, None,
            "hash must be cleared so decide_uploads cannot defensively skip — \
             this is the regression that left items as plaintext on the server"
        );
    }

    /// Regression: disable must (a) drop the cached seed, (b) clear the
    /// local mirror, and (c) mark every journal row dirty AND clear its
    /// hash so the next push re-uploads each item as plaintext. Same
    /// "silent skip" failure mode as enrol if (c) is incomplete — the
    /// server keeps stale ciphertext that the launcher can no longer
    /// decrypt on pull.
    #[test]
    fn apply_local_state_after_disable_clears_seed_clears_mirror_and_force_re_uploads_journal() {
        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let api = ApiClient::new();
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        // Pre-enrolled state: cached seed + populated mirror + dirty
        // journal row with a hash from a previous (ciphertext) push.
        let test_seed: [u8; 32] = rand::random();
        let test_salt: [u8; 32] = rand::random();
        keystore.write_slot(KEYCHAIN_SLOT, &test_seed).unwrap();
        {
            let conn = store.conn().unwrap();
            cloud_sync_e2ee_local::upsert(
                &conn,
                &E2eeLocalState {
                    enrolled: true,
                    key_version: 1,
                    wrapped_master_seed: Some("enc:v1:wrapped".into()),
                    kdf_salt: Some(test_salt.to_vec()),
                    kdf_m_cost: Some(16384),
                    kdf_t_cost: Some(2),
                    kdf_p_cost: Some(1),
                    updated_at_ms: 0,
                    mode: "passphrase".into(),
                    kcv: None,
                    finalize_pending: false,
                },
            )
            .unwrap();
            seed_dirty_journal_row(&conn, "item-1", "clipboard", Some(make_hash(0x99)));
        }

        svc.apply_local_state_after_disable().unwrap();

        // (a) seed gone from keystore.
        assert!(keystore.read_slot(KEYCHAIN_SLOT).unwrap().is_none());

        // (b) mirror cleared.
        let conn = store.conn().unwrap();
        assert!(cloud_sync_e2ee_local::get(&conn).unwrap().is_none());

        // (c) journal row dirty + hash cleared.
        let dirty = cloud_sync_state::get_dirty(&conn).unwrap();
        let row = dirty
            .iter()
            .find(|e| e.item_id == "item-1")
            .expect("item-1 must be in the dirty list after disable");
        assert!(row.is_dirty);
        assert_eq!(row.last_uploaded_hash, None);
    }

    #[test]
    fn keychain_slot_constant_is_distinct_from_layer3() {
        assert_eq!(KEYCHAIN_SLOT, "sync-master-seed-v1");
        assert_ne!(KEYCHAIN_SLOT, crate::crypto::keystore::KEYCHAIN_ACCOUNT);
    }

    #[test]
    fn show_recovery_phrase_rejects_wrong_passphrase() {
        // Set up a local mirror with a wrapped seed that decrypts under "right".
        let salt: [u8; 32] = rand::random();
        let key_right = kdf::derive_wrap_key("right-passphrase-12", &salt, 16384, 2, 1).unwrap();
        let seed: [u8; 32] = rand::random();
        let wrapped = cipher::encrypt(&B64.encode(seed), &key_right).unwrap();

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        cloud_sync_e2ee_local::init_table(&conn).unwrap();
        cloud_sync_e2ee_local::upsert(
            &conn,
            &E2eeLocalState {
                enrolled: true,
                key_version: 1,
                wrapped_master_seed: Some(wrapped.clone()),
                kdf_salt: Some(salt.to_vec()),
                kdf_m_cost: Some(16384),
                kdf_t_cost: Some(2),
                kdf_p_cost: Some(1),
                updated_at_ms: 0,
                mode: "passphrase".into(),
                kcv: None,
                finalize_pending: false,
            },
        )
        .unwrap();

        // The verification logic is in show_recovery_phrase; we exercise its
        // first half (kdf + trial decrypt) directly here without needing a
        // full E2eeService instance.
        let key_wrong = kdf::derive_wrap_key("wrong-passphrase-12", &salt, 16384, 2, 1).unwrap();
        let result = cipher::decrypt(&wrapped, &key_wrong);
        assert!(result.is_err(), "wrong passphrase must fail trial-decrypt");
    }

    #[test]
    fn keystore_slot_isolation() {
        let store = InMemoryKeyStore::new();
        let test_seed: [u8; 32] = rand::random();
        store.write_slot(KEYCHAIN_SLOT, &test_seed).unwrap();
        // Layer 3 master key path uses load_or_create — independent from slots.
        let _master = store.load_or_create().unwrap();
        // E2EE slot survived.
        let seed = store.read_slot(KEYCHAIN_SLOT).unwrap().unwrap();
        assert_eq!(*seed, test_seed.to_vec());
    }

    #[test]
    fn test_load_mode_when_enrolled_but_seed_missing_returns_locked() {
        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let api = ApiClient::new();
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        // Mirror indicates enrolled, but keystore slot has no seed.
        {
            let conn = store.conn().unwrap();
            cloud_sync_e2ee_local::upsert(
                &conn,
                &E2eeLocalState {
                    enrolled: true,
                    key_version: 1,
                    wrapped_master_seed: None,
                    kdf_salt: None,
                    kdf_m_cost: None,
                    kdf_t_cost: None,
                    kdf_p_cost: None,
                    updated_at_ms: 0,
                    mode: "device-key".into(),
                    kcv: Some(vec![1u8; 32]),
                    finalize_pending: false,
                },
            )
            .unwrap();
        }

        let mode = svc.load_mode().unwrap();
        assert!(matches!(mode, Mode::Locked));
        assert!(mode.is_locked());
    }

    #[test]
    fn test_unlock_with_recovery_phrase_device_key_success_and_failure() {
        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let api = ApiClient::new();
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        let seed: [u8; 32] = rand::random();
        let phrase = mnemonic::encode(&seed).unwrap();
        let kcv = crate::sync::e2ee::pairing::compute_kcv(&seed);

        {
            let conn = store.conn().unwrap();
            cloud_sync_e2ee_local::upsert(
                &conn,
                &E2eeLocalState {
                    enrolled: true,
                    key_version: 1,
                    wrapped_master_seed: None,
                    kdf_salt: None,
                    kdf_m_cost: None,
                    kdf_t_cost: None,
                    kdf_p_cost: None,
                    updated_at_ms: 0,
                    mode: "device-key".into(),
                    kcv: Some(kcv.to_vec()),
                    finalize_pending: false,
                },
            )
            .unwrap();
        }

        // 1. Wrong phrase (mismatched KCV) returns Validation error without writing keystore
        let wrong_seed: [u8; 32] = rand::random();
        let wrong_phrase = mnemonic::encode(&wrong_seed).unwrap();
        let err = svc.unlock_with_recovery_phrase(&wrong_phrase).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(keystore.read_slot(KEYCHAIN_SLOT).unwrap().is_none());

        // 2. Correct phrase writes seed to keystore
        svc.unlock_with_recovery_phrase(&phrase).unwrap();
        let cached = keystore.read_slot(KEYCHAIN_SLOT).unwrap().unwrap();
        assert_eq!(*cached, seed.to_vec());
    }

    #[test]
    fn test_show_recovery_phrase_device_key() {
        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let api = ApiClient::new();
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        let seed: [u8; 32] = rand::random();
        let expected_phrase = mnemonic::encode(&seed).unwrap();

        {
            let conn = store.conn().unwrap();
            cloud_sync_e2ee_local::upsert(
                &conn,
                &E2eeLocalState {
                    enrolled: true,
                    key_version: 1,
                    wrapped_master_seed: None,
                    kdf_salt: None,
                    kdf_m_cost: None,
                    kdf_t_cost: None,
                    kdf_p_cost: None,
                    updated_at_ms: 0,
                    mode: "device-key".into(),
                    kcv: Some(vec![1u8; 32]),
                    finalize_pending: false,
                },
            )
            .unwrap();
        }

        // Locked (no seed in keystore) returns SyncE2eeLocked
        let err = svc.show_recovery_phrase_device_key().unwrap_err();
        assert!(matches!(err, AppError::SyncE2eeLocked));

        // When cached in keystore, returns 24 BIP-39 words
        keystore.write_slot(KEYCHAIN_SLOT, &seed).unwrap();
        let phrase = svc.show_recovery_phrase_device_key().unwrap();
        assert_eq!(phrase, expected_phrase);
    }

    #[tokio::test]
    async fn test_disable_rejects_device_key_accounts() {
        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let api = ApiClient::new();
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        {
            let conn = store.conn().unwrap();
            cloud_sync_e2ee_local::upsert(
                &conn,
                &E2eeLocalState {
                    enrolled: true,
                    key_version: 1,
                    wrapped_master_seed: None,
                    kdf_salt: None,
                    kdf_m_cost: None,
                    kdf_t_cost: None,
                    kdf_p_cost: None,
                    updated_at_ms: 0,
                    mode: "device-key".into(),
                    kcv: Some(vec![1u8; 32]),
                    finalize_pending: false,
                },
            )
            .unwrap();
        }

        let err = svc.disable("tok").await.unwrap_err();
        assert!(matches!(err, AppError::SyncE2eeWrongMode(_)));
    }

    #[tokio::test]
    async fn test_auto_enrol_device_key_success() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/api/sync/e2ee/state")
            .with_status(201)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "mode": "device-key",
                    "keyVersion": 1,
                    "enrolledAt": "2026-11-01T12:00:00Z"
                })
                .to_string(),
            )
            .create_async()
            .await;

        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let api = ApiClient::with_base(server.url());
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        svc.auto_enrol("tok").await.unwrap();

        // (a) Seed cached in keystore
        let cached = keystore.read_slot(KEYCHAIN_SLOT).unwrap().unwrap();
        assert_eq!(cached.len(), 32);

        // (b) Local mirror is device-key with finalize_pending
        let conn = store.conn().unwrap();
        let mirror = cloud_sync_e2ee_local::get(&conn).unwrap().unwrap();
        assert!(mirror.enrolled);
        assert_eq!(mirror.mode, "device-key");
        assert!(mirror.finalize_pending);
        assert_eq!(mirror.key_version, 1);
        let expected_kcv =
            crate::sync::e2ee::pairing::compute_kcv(cached.as_slice().try_into().unwrap());
        assert_eq!(mirror.kcv.as_deref(), Some(&expected_kcv[..]));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_auto_enrol_device_key_409_already_enrolled_clears_seed_and_locks() {
        let mut server = mockito::Server::new_async().await;
        let _m_post = server
            .mock("POST", "/api/sync/e2ee/state")
            .with_status(409)
            .with_body(r#"{"code":"sync.e2ee.already-enrolled"}"#)
            .create_async()
            .await;

        let _m_get = server
            .mock("GET", "/api/sync/e2ee/state")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "mode": "device-key",
                    "keyVersion": 1,
                    "enrolledAt": "2026-11-01T12:00:00Z",
                    "kcv": "AAAA"
                })
                .to_string(),
            )
            .create_async()
            .await;

        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let api = ApiClient::with_base(server.url());
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        let err = svc.auto_enrol("tok").await.unwrap_err();
        assert!(matches!(err, AppError::SyncE2eeLocked));

        // Seed deleted from keystore
        assert!(keystore.read_slot(KEYCHAIN_SLOT).unwrap().is_none());

        // Mode is now locked
        let mode = svc.load_mode().unwrap();
        assert!(mode.is_locked());
    }

    #[tokio::test]
    async fn test_finalize_if_pending() {
        let mut server = mockito::Server::new_async().await;
        let mock_finalize = server
            .mock("POST", "/api/sync/e2ee/finalize")
            .with_status(200)
            .with_body(r#"{"deletedRows":10}"#)
            .create_async()
            .await;

        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let api = ApiClient::with_base(server.url());
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        // Mirror with finalize_pending: true
        {
            let conn = store.conn().unwrap();
            cloud_sync_e2ee_local::upsert(
                &conn,
                &E2eeLocalState {
                    enrolled: true,
                    key_version: 1,
                    wrapped_master_seed: None,
                    kdf_salt: None,
                    kdf_m_cost: None,
                    kdf_t_cost: None,
                    kdf_p_cost: None,
                    updated_at_ms: 0,
                    mode: "device-key".into(),
                    kcv: Some(vec![1u8; 32]),
                    finalize_pending: true,
                },
            )
            .unwrap();
        }

        svc.finalize_if_pending("tok", 25).await.unwrap();

        let conn = store.conn().unwrap();
        let mirror = cloud_sync_e2ee_local::get(&conn).unwrap().unwrap();
        assert!(!mirror.finalize_pending);
        mock_finalize.assert_async().await;
    }

    #[tokio::test]
    async fn test_auto_enrol_ambiguous_network_error_reconciles_success() {
        let mut server = mockito::Server::new_async().await;
        // POST returns 500 (AppError::Other)
        let _m_post = server
            .mock("POST", "/api/sync/e2ee/state")
            .with_status(500)
            .with_body("Internal Server Error")
            .create_async()
            .await;

        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let seed = [42u8; 32];
        keystore.write_slot(KEYCHAIN_SLOT, &seed).unwrap();
        let kcv = crate::sync::e2ee::pairing::compute_kcv(&seed);
        let kcv_b64 = B64.encode(kcv);

        let _m_get = server
            .mock("GET", "/api/sync/e2ee/state")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "mode": "device-key",
                    "keyVersion": 1,
                    "enrolledAt": "2026-11-01T12:00:00Z",
                    "kcv": kcv_b64
                })
                .to_string(),
            )
            .create_async()
            .await;

        let api = ApiClient::with_base(server.url());
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        svc.auto_enrol("tok").await.unwrap();

        // Seed is retained
        assert_eq!(
            keystore
                .read_slot(KEYCHAIN_SLOT)
                .unwrap()
                .unwrap()
                .as_slice(),
            &seed
        );

        // Mirror is persisted
        let conn = store.conn().unwrap();
        let mirror = cloud_sync_e2ee_local::get(&conn).unwrap().unwrap();
        assert!(mirror.enrolled);
        assert_eq!(mirror.mode, "device-key");
    }

    #[tokio::test]
    async fn test_ensure_mirror_and_load_mode_preserves_auth_error() {
        let mut server = mockito::Server::new_async().await;
        let _m_get = server
            .mock("GET", "/api/sync/e2ee/state")
            .with_status(401)
            .with_body(r#"{"code":"auth.token-expired"}"#)
            .create_async()
            .await;

        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let api = ApiClient::with_base(server.url());
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        let err = svc.ensure_mirror_and_load_mode("tok").await.unwrap_err();
        assert!(matches!(err, AppError::Auth(_)));
    }

    #[test]
    fn test_load_mode_locks_on_kcv_mismatch() {
        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        let seed = [7u8; 32];
        keystore.write_slot(KEYCHAIN_SLOT, &seed).unwrap();

        // Mirror has a different expected KCV
        let wrong_kcv = vec![99u8; 32];
        let conn = store.conn().unwrap();
        cloud_sync_e2ee_local::upsert(
            &conn,
            &E2eeLocalState {
                enrolled: true,
                key_version: 1,
                wrapped_master_seed: None,
                kdf_salt: None,
                kdf_m_cost: None,
                kdf_t_cost: None,
                kdf_p_cost: None,
                updated_at_ms: 0,
                mode: "device-key".into(),
                kcv: Some(wrong_kcv),
                finalize_pending: false,
            },
        )
        .unwrap();

        let api = ApiClient::with_base("http://localhost:1");
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        let mode = svc.load_mode().unwrap();
        assert!(mode.is_locked());
    }

    #[tokio::test]
    async fn test_reconcile_branch_a_sets_finalize_pending_when_plaintext_rows_exist() {
        reset_last_reconciliation_for_tests();
        let mut server = mockito::Server::new_async().await;
        let seed = [11u8; 32];
        let kcv = crate::sync::e2ee::pairing::compute_kcv(&seed);
        let kcv_b64 = B64.encode(kcv);

        let mock_get = server
            .mock("GET", "/api/sync/e2ee/state")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "mode": "device-key",
                    "keyVersion": 1,
                    "kcv": kcv_b64,
                    "plaintextRows": 8,
                    "enrolledAt": "2026-11-01T12:00:00Z"
                })
                .to_string(),
            )
            .create_async()
            .await;

        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        keystore.write_slot(KEYCHAIN_SLOT, &seed).unwrap();

        let conn = store.conn().unwrap();
        cloud_sync_e2ee_local::upsert(
            &conn,
            &E2eeLocalState {
                enrolled: true,
                key_version: 1,
                wrapped_master_seed: None,
                kdf_salt: None,
                kdf_m_cost: None,
                kdf_t_cost: None,
                kdf_p_cost: None,
                updated_at_ms: 0,
                mode: "device-key".into(),
                kcv: Some(kcv.to_vec()),
                finalize_pending: false,
            },
        )
        .unwrap();

        let api = ApiClient::with_base(server.url());
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        let result = svc.reconcile_server_state("tok").await.unwrap();
        assert_eq!(result, None);

        let mirror = cloud_sync_e2ee_local::get(&conn).unwrap().unwrap();
        assert!(mirror.finalize_pending);
        mock_get.assert_async().await;
    }

    #[tokio::test]
    async fn test_reconcile_branch_b_server_404_resets_local_state_and_marks_dirty() {
        let mut server = mockito::Server::new_async().await;
        let mock_get = server
            .mock("GET", "/api/sync/e2ee/state")
            .with_status(404)
            .with_header("content-type", "application/json")
            .with_body(r#"{"code":"sync.e2ee.not-enrolled"}"#)
            .create_async()
            .await;

        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        keystore.write_slot(KEYCHAIN_SLOT, &[1u8; 32]).unwrap();

        let conn = store.conn().unwrap();
        cloud_sync_e2ee_local::upsert(
            &conn,
            &E2eeLocalState {
                enrolled: true,
                key_version: 1,
                wrapped_master_seed: None,
                kdf_salt: None,
                kdf_m_cost: None,
                kdf_t_cost: None,
                kdf_p_cost: None,
                updated_at_ms: 0,
                mode: "device-key".into(),
                kcv: Some(vec![1u8; 32]),
                finalize_pending: false,
            },
        )
        .unwrap();

        seed_dirty_journal_row(&conn, "item-1", "snippets", Some(make_hash(9)));
        assert_eq!(cloud_sync_state::get_dirty(&conn).unwrap().len(), 0);

        let api = ApiClient::with_base(server.url());
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        let result = svc.reconcile_server_state("tok").await.unwrap();
        assert_eq!(result, Some(Mode::Off));

        // Mirror cleared
        assert!(cloud_sync_e2ee_local::get(&conn).unwrap().is_none());
        // Keystore slot deleted
        assert!(keystore.read_slot(KEYCHAIN_SLOT).unwrap().is_none());
        // Rows marked dirty
        assert_eq!(cloud_sync_state::get_dirty(&conn).unwrap().len(), 1);
        mock_get.assert_async().await;
    }

    #[tokio::test]
    async fn test_reconcile_branch_c_server_kcv_or_mode_mismatch_updates_mirror_and_locks() {
        let mut server = mockito::Server::new_async().await;
        let kcv2 = vec![99u8; 32];
        let kcv2_b64 = B64.encode(&kcv2);

        let mock_get = server
            .mock("GET", "/api/sync/e2ee/state")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "mode": "device-key",
                    "keyVersion": 2,
                    "kcv": kcv2_b64,
                    "plaintextRows": 0,
                    "enrolledAt": "2026-11-01T12:00:00Z"
                })
                .to_string(),
            )
            .create_async()
            .await;

        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        keystore.write_slot(KEYCHAIN_SLOT, &[1u8; 32]).unwrap();

        let conn = store.conn().unwrap();
        cloud_sync_e2ee_local::upsert(
            &conn,
            &E2eeLocalState {
                enrolled: true,
                key_version: 1,
                wrapped_master_seed: None,
                kdf_salt: None,
                kdf_m_cost: None,
                kdf_t_cost: None,
                kdf_p_cost: None,
                updated_at_ms: 0,
                mode: "device-key".into(),
                kcv: Some(vec![1u8; 32]),
                finalize_pending: false,
            },
        )
        .unwrap();

        let api = ApiClient::with_base(server.url());
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        let result = svc.reconcile_server_state("tok").await.unwrap();
        assert_eq!(result, Some(Mode::Locked));

        // Mirror updated with kcv2 and key_version 2
        let mirror = cloud_sync_e2ee_local::get(&conn).unwrap().unwrap();
        assert_eq!(mirror.key_version, 2);
        assert_eq!(mirror.kcv, Some(kcv2));
        // Keystore slot deleted
        assert!(keystore.read_slot(KEYCHAIN_SLOT).unwrap().is_none());
        mock_get.assert_async().await;
    }

    #[tokio::test]
    async fn test_reconcile_transient_error_tolerance() {
        let mut server = mockito::Server::new_async().await;
        let mock_get = server
            .mock("GET", "/api/sync/e2ee/state")
            .with_status(500)
            .with_body("Internal Server Error")
            .create_async()
            .await;

        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        keystore.write_slot(KEYCHAIN_SLOT, &[1u8; 32]).unwrap();

        let conn = store.conn().unwrap();
        cloud_sync_e2ee_local::upsert(
            &conn,
            &E2eeLocalState {
                enrolled: true,
                key_version: 1,
                wrapped_master_seed: None,
                kdf_salt: None,
                kdf_m_cost: None,
                kdf_t_cost: None,
                kdf_p_cost: None,
                updated_at_ms: 0,
                mode: "device-key".into(),
                kcv: Some(vec![1u8; 32]),
                finalize_pending: false,
            },
        )
        .unwrap();

        let api = ApiClient::with_base(server.url());
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        let result = svc.reconcile_server_state("tok").await.unwrap();
        // Transient error caught and returns None; does not fail sync!
        assert_eq!(result, None);

        // State remains intact
        assert!(cloud_sync_e2ee_local::get(&conn).unwrap().is_some());
        assert!(keystore.read_slot(KEYCHAIN_SLOT).unwrap().is_some());
        mock_get.assert_async().await;
    }

    #[tokio::test]
    async fn test_reconcile_frequency_skips_within_24_hours() {
        reset_last_reconciliation_for_tests();
        let mut server = mockito::Server::new_async().await;
        let seed = [22u8; 32];
        let kcv = crate::sync::e2ee::pairing::compute_kcv(&seed);
        let kcv_b64 = B64.encode(kcv);

        let mock_get = server
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
            .expect(1)
            .create_async()
            .await;

        let store = create_test_store();
        let keystore = InMemoryKeyStore::new();
        keystore.write_slot(KEYCHAIN_SLOT, &seed).unwrap();

        let conn = store.conn().unwrap();
        cloud_sync_e2ee_local::upsert(
            &conn,
            &E2eeLocalState {
                enrolled: true,
                key_version: 1,
                wrapped_master_seed: None,
                kdf_salt: None,
                kdf_m_cost: None,
                kdf_t_cost: None,
                kdf_p_cost: None,
                updated_at_ms: 0,
                mode: "device-key".into(),
                kcv: Some(kcv.to_vec()),
                finalize_pending: false,
            },
        )
        .unwrap();

        let api = ApiClient::with_base(server.url());
        let svc = E2eeService {
            api: &api,
            keystore: &keystore,
            data_store: &store,
        };

        // 1st call in session: executes
        let res1 = svc.reconcile_server_state_if_due("tok").await.unwrap();
        assert_eq!(res1, None);

        // 2nd call: within 24h, must NOT hit server (expect 1 would fail if called)
        let res2 = svc.reconcile_server_state_if_due("tok").await.unwrap();
        assert_eq!(res2, None);

        mock_get.assert_async().await;
    }
}
