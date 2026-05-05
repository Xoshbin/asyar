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
use rand::RngCore;
use zeroize::Zeroizing;

fn current_unix_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
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

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct E2eeStatusReport {
    pub enabled: bool,
    /// Enrolled but no cached master_seed (e.g. fresh second-device install).
    pub locked: bool,
    pub key_version: Option<u64>,
}

impl<'a> E2eeService<'a> {
    /// Compute the current sync mode by reading the keychain + local mirror.
    /// Returns `Mode::Off` if disabled OR if enrolled-but-locked (caller is
    /// responsible for prompting the user to unlock).
    pub fn load_mode(&self) -> Result<Mode, AppError> {
        let conn = self.data_store.conn()?;
        let local = cloud_sync_e2ee_local::get(&conn)?;
        match local {
            None => Ok(Mode::Off),
            Some(state) if !state.enrolled => Ok(Mode::Off),
            Some(state) => match self.keystore.read_slot(KEYCHAIN_SLOT)? {
                None => Ok(Mode::Off), // enrolled but locked
                Some(seed_bytes) => {
                    if seed_bytes.len() != 32 {
                        return Err(AppError::Encryption(
                            "cached master_seed wrong length".into(),
                        ));
                    }
                    let mut seed = Zeroizing::new([0u8; 32]);
                    seed.copy_from_slice(&seed_bytes);
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
        Ok(match local {
            None => E2eeStatusReport {
                enabled: false,
                locked: false,
                key_version: None,
            },
            Some(s) => E2eeStatusReport {
                enabled: s.enrolled,
                locked: s.enrolled && !cached,
                key_version: Some(s.key_version as u64),
            },
        })
    }

    /// Generate fresh master_seed, derive wrap_key, wrap, POST to server,
    /// cache locally, return the 24-word recovery phrase.
    pub async fn enrol(&self, token: &str, passphrase: &str) -> Result<EnrolmentResult, AppError> {
        let mut seed = Zeroizing::new([0u8; 32]);
        rand::thread_rng().fill_bytes(&mut *seed);
        let mut salt = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut salt);

        let wrap_key = kdf::derive_wrap_key(
            passphrase,
            &salt,
            kdf::ARGON2_M_COST,
            kdf::ARGON2_T_COST,
            kdf::ARGON2_P_COST,
        )?;
        let wrapped = cipher::encrypt(&B64.encode(*seed), &wrap_key)?;

        let payload = E2eeStatePayload {
            wrapped_master_seed: wrapped,
            kdf_salt: B64.encode(salt),
            kdf_algorithm: "argon2id".into(),
            kdf_m_cost: kdf::ARGON2_M_COST,
            kdf_t_cost: kdf::ARGON2_T_COST,
            kdf_p_cost: kdf::ARGON2_P_COST,
        };
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
        let wrap_key = kdf::derive_wrap_key(
            passphrase,
            &local.kdf_salt,
            local.kdf_m_cost as u32,
            local.kdf_t_cost as u32,
            local.kdf_p_cost as u32,
        )?;
        let seed_b64 = cipher::decrypt(&local.wrapped_master_seed, &wrap_key)
            .map_err(|_| AppError::Validation("incorrect passphrase".into()))?;
        let seed_bytes = B64
            .decode(seed_b64.as_bytes())
            .map_err(|e| AppError::Encryption(format!("decode seed: {e}")))?;
        if seed_bytes.len() != 32 {
            return Err(AppError::Encryption("decoded seed wrong length".into()));
        }
        self.keystore.write_slot(KEYCHAIN_SLOT, &seed_bytes)?;
        Ok(())
    }

    pub async fn rotate(
        &self,
        token: &str,
        old: &str,
        new: &str,
    ) -> Result<(), AppError> {
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

            let new_salt = local.kdf_salt.clone(); // keep same salt — only passphrase changes
            let new_wrap_key = kdf::derive_wrap_key(
                new,
                &new_salt,
                local.kdf_m_cost as u32,
                local.kdf_t_cost as u32,
                local.kdf_p_cost as u32,
            )?;
            let new_wrapped = cipher::encrypt(&B64.encode(&*seed_bytes), &new_wrap_key)?;

            let mut salt_array = [0u8; 32];
            if new_salt.len() == 32 {
                salt_array.copy_from_slice(&new_salt);
            } else {
                return Err(AppError::Encryption("kdf_salt wrong length".into()));
            }

            let payload = E2eeStatePayload {
                wrapped_master_seed: new_wrapped,
                kdf_salt: B64.encode(salt_array),
                kdf_algorithm: "argon2id".into(),
                kdf_m_cost: local.kdf_m_cost as u32,
                kdf_t_cost: local.kdf_t_cost as u32,
                kdf_p_cost: local.kdf_p_cost as u32,
            };
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
            crate::crypto::sync_envelope::decrypt_payload(ct, &recovered_seed).map_err(
                |_| AppError::Validation("recovery phrase doesn't match your account".into()),
            )?;
        }

        let mut salt = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut salt);
        let wrap_key = kdf::derive_wrap_key(
            new_passphrase,
            &salt,
            kdf::ARGON2_M_COST,
            kdf::ARGON2_T_COST,
            kdf::ARGON2_P_COST,
        )?;
        let wrapped = cipher::encrypt(&B64.encode(*recovered_seed), &wrap_key)?;
        let payload = E2eeStatePayload {
            wrapped_master_seed: wrapped,
            kdf_salt: B64.encode(salt),
            kdf_algorithm: "argon2id".into(),
            kdf_m_cost: kdf::ARGON2_M_COST,
            kdf_t_cost: kdf::ARGON2_T_COST,
            kdf_p_cost: kdf::ARGON2_P_COST,
        };
        let resp = self.api.put_e2ee_state(token, &payload).await?;
        self.keystore.write_slot(KEYCHAIN_SLOT, &*recovered_seed)?;
        self.persist_local(&payload, &salt, resp.key_version)?;
        Ok(())
    }

    pub async fn disable(&self, token: &str) -> Result<(), AppError> {
        self.api.delete_e2ee_state(token).await?;
        self.apply_local_state_after_disable()?;
        Ok(())
    }

    pub fn show_recovery_phrase(&self, passphrase: &str) -> Result<String, AppError> {
        let conn = self.data_store.conn()?;
        let local = cloud_sync_e2ee_local::get(&conn)?
            .ok_or_else(|| AppError::Validation("not enrolled".into()))?;

        // Verify passphrase by trial-decrypting the stored wrapped seed.
        let wrap_key = kdf::derive_wrap_key(
            passphrase,
            &local.kdf_salt,
            local.kdf_m_cost as u32,
            local.kdf_t_cost as u32,
            local.kdf_p_cost as u32,
        )?;
        cipher::decrypt(&local.wrapped_master_seed, &wrap_key)
            .map_err(|_| AppError::Validation("incorrect passphrase".into()))?;

        // Read seed from keychain and BIP-39 encode.
        let seed_bytes = self
            .keystore
            .read_slot(KEYCHAIN_SLOT)?
            .ok_or_else(|| AppError::Encryption("master_seed not cached".into()))?;
        if seed_bytes.len() != 32 {
            return Err(AppError::Encryption("cached master_seed wrong length".into()));
        }
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&seed_bytes);
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
            kdf_salt: salt.to_vec(),
            kdf_m_cost: payload.kdf_m_cost as i64,
            kdf_t_cost: payload.kdf_t_cost as i64,
            kdf_p_cost: payload.kdf_p_cost as i64,
            updated_at_ms: current_unix_ms(),
        };
        let conn = self.data_store.conn()?;
        cloud_sync_e2ee_local::upsert(&conn, &state)?;
        Ok(())
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
        E2eeStatePayload {
            wrapped_master_seed: "enc:v1:dummy".into(),
            kdf_salt: B64.encode([7u8; 32]),
            kdf_algorithm: "argon2id".into(),
            kdf_m_cost: kdf::ARGON2_M_COST,
            kdf_t_cost: kdf::ARGON2_T_COST,
            kdf_p_cost: kdf::ARGON2_P_COST,
        }
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

        let seed = [9u8; 32];
        let payload = dummy_payload();
        let salt = [7u8; 32];

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
        assert_eq!(mirror.kdf_salt, salt.to_vec());

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
        keystore.write_slot(KEYCHAIN_SLOT, &[1u8; 32]).unwrap();
        {
            let conn = store.conn().unwrap();
            cloud_sync_e2ee_local::upsert(
                &conn,
                &E2eeLocalState {
                    enrolled: true,
                    key_version: 1,
                    wrapped_master_seed: "enc:v1:wrapped".into(),
                    kdf_salt: vec![7u8; 32],
                    kdf_m_cost: 16384,
                    kdf_t_cost: 2,
                    kdf_p_cost: 1,
                    updated_at_ms: 0,
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
        let salt = [9u8; 32];
        let key_right = kdf::derive_wrap_key("right-passphrase-12", &salt, 16384, 2, 1).unwrap();
        let seed = [42u8; 32];
        let wrapped = cipher::encrypt(&B64.encode(seed), &key_right).unwrap();

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        cloud_sync_e2ee_local::init_table(&conn).unwrap();
        cloud_sync_e2ee_local::upsert(
            &conn,
            &E2eeLocalState {
                enrolled: true,
                key_version: 1,
                wrapped_master_seed: wrapped.clone(),
                kdf_salt: salt.to_vec(),
                kdf_m_cost: 16384,
                kdf_t_cost: 2,
                kdf_p_cost: 1,
                updated_at_ms: 0,
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
        store.write_slot(KEYCHAIN_SLOT, &[42u8; 32]).unwrap();
        // Layer 3 master key path uses load_or_create — independent from slots.
        let _master = store.load_or_create().unwrap();
        // E2EE slot survived.
        let seed = store.read_slot(KEYCHAIN_SLOT).unwrap().unwrap();
        assert_eq!(*seed, vec![42u8; 32]);
    }
}
