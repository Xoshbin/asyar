use crate::crypto::cipher;
use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use zeroize::Zeroizing;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CredentialState {
    NotConfigured,
    Configured,
    NeedsReentry,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CredentialTarget {
    #[serde(rename = "provider")]
    Provider { id: String },
    #[serde(rename = "webSearch")]
    WebSearch,
}

impl CredentialTarget {
    pub fn to_credential_id(&self) -> String {
        match self {
            CredentialTarget::Provider { id } => format!("provider:{id}"),
            CredentialTarget::WebSearch => "web_search".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentialStatus {
    pub providers: HashMap<String, CredentialState>,
    pub web_search: CredentialState,
}

/// Initialize the `ai_credentials` table (tests only; production uses migration 8).
#[cfg(test)]
pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_credentials (
            credential_id TEXT PRIMARY KEY,
            ciphertext    TEXT NOT NULL,
            updated_at    INTEGER NOT NULL
        );",
    )
    .map_err(|e| AppError::Database(format!("Failed to init ai_credentials: {e}")))?;
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Encrypts `secret` under `master_key` and saves or replaces it in `ai_credentials`.
pub fn set(
    conn: &Connection,
    credential_id: &str,
    secret: &str,
    master_key: &[u8; 32],
) -> Result<(), AppError> {
    let ciphertext = cipher::encrypt(secret, master_key)?;
    let now = now_millis();
    conn.execute(
        "INSERT INTO ai_credentials (credential_id, ciphertext, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(credential_id) DO UPDATE SET
             ciphertext = excluded.ciphertext,
             updated_at = excluded.updated_at",
        params![credential_id, ciphertext, now],
    )?;
    Ok(())
}

/// Retrieves and decrypts the secret for `credential_id`.
///
/// Returns `Ok(None)` if no record exists for `credential_id`.
/// Returns `Err(AppError::Encryption)` if the record exists but cannot be decrypted
/// under `master_key` (e.g. master key changed or data corrupted).
pub fn get(
    conn: &Connection,
    credential_id: &str,
    master_key: &[u8; 32],
) -> Result<Option<Zeroizing<String>>, AppError> {
    let ciphertext: Option<String> = conn
        .query_row(
            "SELECT ciphertext FROM ai_credentials WHERE credential_id = ?1",
            params![credential_id],
            |row| row.get(0),
        )
        .optional()?;

    let Some(ciphertext) = ciphertext else {
        return Ok(None);
    };

    let plaintext = cipher::decrypt(&ciphertext, master_key)?;
    Ok(Some(Zeroizing::new(plaintext)))
}

/// Deletes the credential row for `credential_id`.
/// Returns `Ok(true)` if a row was deleted, `Ok(false)` if no row existed.
pub fn delete(conn: &Connection, credential_id: &str) -> Result<bool, AppError> {
    let n = conn.execute(
        "DELETE FROM ai_credentials WHERE credential_id = ?1",
        params![credential_id],
    )?;
    Ok(n > 0)
}

/// Checks the state of a credential under `master_key`.
///
/// - `NotConfigured`: No row exists.
/// - `Configured`: Row exists and decrypts successfully.
/// - `NeedsReentry`: Row exists but fails decryption (e.g. Keychain master key changed). Never panics.
pub fn status(
    conn: &Connection,
    credential_id: &str,
    master_key: &[u8; 32],
) -> Result<CredentialState, AppError> {
    let ciphertext: Option<String> = conn
        .query_row(
            "SELECT ciphertext FROM ai_credentials WHERE credential_id = ?1",
            params![credential_id],
            |row| row.get(0),
        )
        .optional()?;

    let Some(ciphertext) = ciphertext else {
        return Ok(CredentialState::NotConfigured);
    };

    match cipher::decrypt(&ciphertext, master_key) {
        Ok(_) => Ok(CredentialState::Configured),
        Err(_) => Ok(CredentialState::NeedsReentry),
    }
}

/// Retrieves statuses for all records currently in `ai_credentials`.
pub fn list_all_statuses(
    conn: &Connection,
    master_key: &[u8; 32],
) -> Result<HashMap<String, CredentialState>, AppError> {
    let mut stmt = conn.prepare("SELECT credential_id, ciphertext FROM ai_credentials")?;
    let rows = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let ct: String = row.get(1)?;
        Ok((id, ct))
    })?;

    let mut map = HashMap::new();
    for row in rows {
        let (id, ct) = row?;
        let state = match cipher::decrypt(&ct, master_key) {
            Ok(_) => CredentialState::Configured,
            Err(_) => CredentialState::NeedsReentry,
        };
        map.insert(id, state);
    }

    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_key() -> [u8; 32] {
        rand::random()
    }

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    #[test]
    fn credential_target_mapping() {
        assert_eq!(
            CredentialTarget::Provider {
                id: "openai".into()
            }
            .to_credential_id(),
            "provider:openai"
        );
        assert_eq!(
            CredentialTarget::Provider {
                id: "custom_123".into()
            }
            .to_credential_id(),
            "provider:custom_123"
        );
        assert_eq!(CredentialTarget::WebSearch.to_credential_id(), "web_search");
    }

    #[test]
    fn roundtrip_set_get_status_delete() {
        let conn = setup();
        let key = test_key();
        let cred_id = "provider:openai";

        // Initial status: NotConfigured
        assert_eq!(
            status(&conn, cred_id, &key).unwrap(),
            CredentialState::NotConfigured
        );
        assert_eq!(get(&conn, cred_id, &key).unwrap(), None);

        // Set credential
        let fake_key = "sk-fake-openai-test-key-12345";
        set(&conn, cred_id, fake_key, &key).unwrap();

        // Status is now Configured
        assert_eq!(
            status(&conn, cred_id, &key).unwrap(),
            CredentialState::Configured
        );

        // Get decrypts accurately
        let retrieved = get(&conn, cred_id, &key).unwrap().unwrap();
        assert_eq!(&*retrieved, fake_key);

        // Delete
        assert!(delete(&conn, cred_id).unwrap());
        assert_eq!(
            status(&conn, cred_id, &key).unwrap(),
            CredentialState::NotConfigured
        );
        assert_eq!(get(&conn, cred_id, &key).unwrap(), None);

        // Delete again returns false
        assert!(!delete(&conn, cred_id).unwrap());
    }

    #[test]
    fn different_master_key_produces_needs_reentry() {
        let conn = setup();
        let key1 = test_key();
        let key2 = test_key();
        let cred_id = "provider:anthropic";
        let fake_key = "sk-ant-test-fake-key-54321";

        set(&conn, cred_id, fake_key, &key1).unwrap();

        // Under key1, it is Configured and readable
        assert_eq!(
            status(&conn, cred_id, &key1).unwrap(),
            CredentialState::Configured
        );
        assert_eq!(&*get(&conn, cred_id, &key1).unwrap().unwrap(), fake_key);

        // Under key2, status is NeedsReentry (never panics)
        assert_eq!(
            status(&conn, cred_id, &key2).unwrap(),
            CredentialState::NeedsReentry
        );

        // get fails with Encryption error
        assert!(get(&conn, cred_id, &key2).is_err());

        // Overwriting under key2 repairs it
        let new_fake_key = "sk-ant-test-fake-key-reentered";
        set(&conn, cred_id, new_fake_key, &key2).unwrap();
        assert_eq!(
            status(&conn, cred_id, &key2).unwrap(),
            CredentialState::Configured
        );
        assert_eq!(&*get(&conn, cred_id, &key2).unwrap().unwrap(), new_fake_key);
    }

    #[test]
    fn list_all_statuses_reports_each_row() {
        let conn = setup();
        let key = test_key();

        set(&conn, "provider:openai", "key-1", &key).unwrap();
        set(&conn, "provider:custom_1", "key-2", &key).unwrap();
        set(&conn, "web_search", "key-3", &key).unwrap();

        let all = list_all_statuses(&conn, &key).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(
            all.get("provider:openai"),
            Some(&CredentialState::Configured)
        );
        assert_eq!(
            all.get("provider:custom_1"),
            Some(&CredentialState::Configured)
        );
        assert_eq!(all.get("web_search"), Some(&CredentialState::Configured));
    }

    #[test]
    fn test_ai_credentials_never_syncable() {
        let conn = setup();
        let key = test_key();

        // Populate credentials
        set(&conn, "provider:openai", "sk-secret-test-openai", &key).unwrap();
        set(
            &conn,
            "provider:anthropic",
            "sk-secret-test-anthropic",
            &key,
        )
        .unwrap();
        set(&conn, "web_search", "secret-test-brave", &key).unwrap();

        // 1. Initialize cloud sync tables in the same DB
        crate::cloud_sync_state::init_table(&conn).unwrap();

        // 2. Assert no sync journal entries exist for ai_credentials or provider keys
        let sync_journal_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cloud_sync_items_journal
                 WHERE category_id IN ('ai_credentials', 'credentials', 'ai')
                    OR item_id LIKE 'provider:%'
                    OR item_id = 'web_search'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            sync_journal_count, 0,
            "ai_credentials items must NEVER be recorded in cloud_sync_items_journal"
        );

        // 3. Verify known sync categories never include ai_credentials or secrets
        let known_sync_categories = [
            "clipboard",
            "snippets",
            "notes",
            "portals",
            "shortcuts",
            "settings",
            "ai-settings",
            "extensions",
            "extension-preferences",
        ];
        for cat in known_sync_categories {
            assert_ne!(
                cat, "ai_credentials",
                "ai_credentials cannot be a sync category"
            );
        }
    }
}
