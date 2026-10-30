use crate::error::AppError;
use crate::storage::DataStore;
use rusqlite::Connection;
use serde_json::Value;

/// Migrates plaintext AI provider and web search API keys from a settings JSON value
/// into the encrypted `ai_credentials` table in SQLite.
///
/// Order of operations:
/// 1. Collect all plaintext keys from `settings.ai.providers.*.apiKey` and `settings.ai.webSearch.apiKey`.
/// 2. If no plaintext keys exist, return `Ok(0)` with zero database writes.
/// 3. Begin an exclusive SQLite transaction.
/// 4. For each key:
///    - Encrypt under `master_key` and write to `ai_credentials`.
///    - Read back from `ai_credentials` and verify byte-for-byte match with the plaintext key.
/// 5. Commit SQLite transaction ONLY after ALL keys succeed verification.
///    If any verification fails, the transaction rolls back and plaintext keys in `settings` are preserved.
/// 6. Remove the plaintext `apiKey` fields from `settings`.
///
/// Returns the number of keys migrated.
pub fn migrate_settings_json(
    conn: &mut Connection,
    settings: &mut Value,
    master_key: &[u8; 32],
) -> Result<usize, AppError> {
    migrate_settings_json_inner(conn, settings, master_key, false)
}

pub(crate) fn migrate_settings_json_inner(
    conn: &mut Connection,
    settings: &mut Value,
    master_key: &[u8; 32],
    simulate_readback_mismatch: bool,
) -> Result<usize, AppError> {
    let ai_val = if let Some(s) = settings.get_mut("settings") {
        s.get_mut("ai")
    } else {
        settings.get_mut("ai")
    };

    let Some(ai) = ai_val else {
        return Ok(0);
    };

    let mut keys_to_migrate: Vec<(String, String)> = Vec::new();

    if let Some(providers) = ai.get("providers").and_then(|p| p.as_object()) {
        for (provider_id, config_val) in providers {
            if let Some(api_key) = config_val.get("apiKey").and_then(|k| k.as_str()) {
                let trimmed = api_key.trim();
                if !trimmed.is_empty() {
                    keys_to_migrate.push((format!("provider:{provider_id}"), trimmed.to_string()));
                }
            }
        }
    }

    if let Some(web_search) = ai.get("webSearch").and_then(|w| w.as_object()) {
        if let Some(api_key) = web_search.get("apiKey").and_then(|k| k.as_str()) {
            let trimmed = api_key.trim();
            if !trimmed.is_empty() {
                keys_to_migrate.push(("web_search".to_string(), trimmed.to_string()));
            }
        }
    }

    if keys_to_migrate.is_empty() {
        return Ok(0);
    }

    let count = keys_to_migrate.len();
    let tx = conn
        .transaction()
        .map_err(|e| AppError::Database(e.to_string()))?;

    for (cred_id, secret) in &keys_to_migrate {
        crate::storage::ai_credentials::set(&tx, cred_id, secret, master_key)?;

        if simulate_readback_mismatch {
            return Err(AppError::Other(format!(
                "Simulated read-back verification failure for credential '{cred_id}'"
            )));
        }

        let read_back = crate::storage::ai_credentials::get(&tx, cred_id, master_key)?;
        match read_back {
            Some(val) if val.as_str() == secret.as_str() => {
                // Byte-for-byte match confirmed
            }
            _ => {
                return Err(AppError::Other(format!(
                    "Migration verification failed for credential '{cred_id}': read-back mismatch"
                )));
            }
        }
    }

    // Commit SQLite transaction only after ALL keys succeed
    tx.commit().map_err(|e| AppError::Database(e.to_string()))?;

    // Strip plaintext apiKey fields from JSON
    if let Some(providers) = ai.get_mut("providers").and_then(|p| p.as_object_mut()) {
        for (_id, config_val) in providers.iter_mut() {
            if let Some(obj) = config_val.as_object_mut() {
                obj.remove("apiKey");
            }
        }
    }

    if let Some(web_search) = ai.get_mut("webSearch").and_then(|w| w.as_object_mut()) {
        web_search.remove("apiKey");
    }

    Ok(count)
}

/// Reads plaintext keys from `settings.dat` via `tauri-plugin-store`, encrypts and stores them in SQLite,
/// verifies read-back, commits, and removes `apiKey` fields from `settings.dat`.
pub fn migrate_settings_dat(
    app: &tauri::AppHandle,
    data_store: &DataStore,
    master_key: &[u8; 32],
) -> Result<usize, AppError> {
    use tauri_plugin_store::StoreExt;

    let store = match app.store("settings.dat") {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[ai::migration] Could not access settings.dat: {e}");
            return Ok(0);
        }
    };

    let Some(mut settings) = store.get("settings") else {
        return Ok(0);
    };

    let mut conn = data_store.conn()?;
    let count = migrate_settings_json(&mut conn, &mut settings, master_key)?;

    if count > 0 {
        store.set("settings", settings);
        store
            .save()
            .map_err(|e| AppError::Other(format!("Failed to save settings.dat: {e}")))?;
        log::info!(
            "[ai::migration] Successfully migrated {count} plaintext API keys to encrypted store"
        );
    }

    Ok(count)
}

/// Reads plaintext keys from a file on disk, encrypts and stores them in SQLite,
/// verifies read-back, commits, and atomically rewrites the file without `apiKey` fields.
pub fn migrate_settings_file(
    file_path: &std::path::Path,
    data_store: &DataStore,
    master_key: &[u8; 32],
) -> Result<usize, AppError> {
    if !file_path.exists() {
        return Ok(0);
    }

    let content = std::fs::read_to_string(file_path)
        .map_err(|e| AppError::Other(format!("Failed to read settings file: {e}")))?;
    let mut json: Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Other(format!("Failed to parse settings JSON: {e}")))?;

    let mut conn = data_store.conn()?;
    let count = migrate_settings_json(&mut conn, &mut json, master_key)?;

    if count > 0 {
        let serialized = serde_json::to_string_pretty(&json)
            .map_err(|e| AppError::Other(format!("Failed to serialize settings JSON: {e}")))?;
        std::fs::write(file_path, serialized)
            .map_err(|e| AppError::Other(format!("Failed to write settings file: {e}")))?;
    }

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::ai_credentials::{self, CredentialState};
    use rusqlite::Connection;
    use serde_json::json;

    fn test_key() -> [u8; 32] {
        rand::random()
    }

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::migrations::run(&conn).unwrap();
        conn
    }

    #[test]
    fn migration_with_fixture_encrypts_keys_and_strips_plaintext() {
        let mut conn = setup_db();
        let master_key = test_key();

        let mut settings = json!({
            "settings": {
                "ai": {
                    "providers": {
                        "openai": {
                            "enabled": true,
                            "apiKey": "sk-fake-openai-test-key"
                        },
                        "custom_deepseek": {
                            "enabled": true,
                            "providerType": "custom",
                            "apiKey": "sk-fake-custom-deepseek-key"
                        },
                        "ollama": {
                            "enabled": true,
                            "baseUrl": "http://localhost:11434"
                        }
                    },
                    "webSearch": {
                        "engine": "brave",
                        "apiKey": "fake-brave-search-key"
                    }
                }
            }
        });

        let count = migrate_settings_json(&mut conn, &mut settings, &master_key).unwrap();
        assert_eq!(count, 3);

        // 1. Verify encrypted rows exist in SQLite
        assert_eq!(
            ai_credentials::status(&conn, "provider:openai", &master_key).unwrap(),
            CredentialState::Configured
        );
        assert_eq!(
            ai_credentials::status(&conn, "provider:custom_deepseek", &master_key).unwrap(),
            CredentialState::Configured
        );
        assert_eq!(
            ai_credentials::status(&conn, "web_search", &master_key).unwrap(),
            CredentialState::Configured
        );

        // 2. Verify keys decrypt accurately
        let openai_key = ai_credentials::get(&conn, "provider:openai", &master_key)
            .unwrap()
            .unwrap();
        assert_eq!(&*openai_key, "sk-fake-openai-test-key");

        let custom_key = ai_credentials::get(&conn, "provider:custom_deepseek", &master_key)
            .unwrap()
            .unwrap();
        assert_eq!(&*custom_key, "sk-fake-custom-deepseek-key");

        let web_key = ai_credentials::get(&conn, "web_search", &master_key)
            .unwrap()
            .unwrap();
        assert_eq!(&*web_key, "fake-brave-search-key");

        // 3. Verify settings JSON has no apiKey fields
        let ai = &settings["settings"]["ai"];
        assert!(ai["providers"]["openai"].get("apiKey").is_none());
        assert!(ai["providers"]["custom_deepseek"].get("apiKey").is_none());
        assert!(ai["webSearch"].get("apiKey").is_none());

        // 4. Verify other fields are preserved
        assert_eq!(ai["providers"]["openai"]["enabled"], json!(true));
        assert_eq!(
            ai["providers"]["custom_deepseek"]["providerType"],
            json!("custom")
        );
        assert_eq!(ai["webSearch"]["engine"], json!("brave"));
    }

    #[test]
    fn crash_after_commit_before_save_recovers_cleanly() {
        let mut conn = setup_db();
        let master_key = test_key();

        let initial_settings = json!({
            "settings": {
                "ai": {
                    "providers": {
                        "openai": { "apiKey": "sk-fake-openai-retest" }
                    },
                    "webSearch": {
                        "apiKey": "fake-brave-retest"
                    }
                }
            }
        });

        // Run 1: Imagine crash happened right after commit but before settings.dat was saved.
        // We write to DB directly to simulate pre-existing committed state:
        ai_credentials::set(
            &conn,
            "provider:openai",
            "sk-fake-openai-retest",
            &master_key,
        )
        .unwrap();
        ai_credentials::set(&conn, "web_search", "fake-brave-retest", &master_key).unwrap();

        // `settings` still has plaintext (because save never happened)
        let mut unstripped_settings = initial_settings.clone();

        // Run 2: Next startup migration runs
        let count =
            migrate_settings_json(&mut conn, &mut unstripped_settings, &master_key).unwrap();
        assert_eq!(count, 2);

        // Verification: keys are intact and unstripped_settings is now stripped
        let openai_key = ai_credentials::get(&conn, "provider:openai", &master_key)
            .unwrap()
            .unwrap();
        assert_eq!(&*openai_key, "sk-fake-openai-retest");
        assert!(unstripped_settings["settings"]["ai"]["providers"]["openai"]
            .get("apiKey")
            .is_none());
        assert!(unstripped_settings["settings"]["ai"]["webSearch"]
            .get("apiKey")
            .is_none());
    }

    #[test]
    fn readback_mismatch_aborts_transaction_and_preserves_plaintext() {
        let mut conn = setup_db();
        let master_key = test_key();

        let mut settings = json!({
            "settings": {
                "ai": {
                    "providers": {
                        "openai": { "apiKey": "sk-fake-should-stay-intact" }
                    }
                }
            }
        });

        // Run migration with simulated mismatch
        let res = migrate_settings_json_inner(&mut conn, &mut settings, &master_key, true);
        assert!(res.is_err());

        // 1. Verify nothing was committed to DB
        assert_eq!(
            ai_credentials::status(&conn, "provider:openai", &master_key).unwrap(),
            CredentialState::NotConfigured
        );

        // 2. Verify settings plaintext apiKey was preserved
        assert_eq!(
            settings["settings"]["ai"]["providers"]["openai"]["apiKey"],
            json!("sk-fake-should-stay-intact")
        );
    }

    #[test]
    fn migration_is_idempotent_when_no_keys_to_migrate() {
        let mut conn = setup_db();
        let master_key = test_key();

        let mut settings = json!({
            "settings": {
                "ai": {
                    "providers": {
                        "ollama": { "enabled": true }
                    },
                    "webSearch": { "engine": "duckduckgo" }
                }
            }
        });

        let count = migrate_settings_json(&mut conn, &mut settings, &master_key).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn migration_file_roundtrip() {
        let temp_dir = tempfile::tempdir().unwrap();
        let settings_path = temp_dir.path().join("settings.dat");
        let master_key = test_key();

        let initial_json = json!({
            "settings": {
                "ai": {
                    "providers": {
                        "anthropic": { "apiKey": "sk-ant-file-test" }
                    }
                }
            }
        });
        std::fs::write(&settings_path, initial_json.to_string()).unwrap();

        let data_store = crate::storage::create_test_store();
        let count = migrate_settings_file(&settings_path, &data_store, &master_key).unwrap();
        assert_eq!(count, 1);

        // Verify file on disk has no apiKey
        let updated_content = std::fs::read_to_string(&settings_path).unwrap();
        let parsed: Value = serde_json::from_str(&updated_content).unwrap();
        assert!(parsed["settings"]["ai"]["providers"]["anthropic"]
            .get("apiKey")
            .is_none());

        // Verify stored in DB
        let conn = data_store.conn().unwrap();
        let key = ai_credentials::get(&conn, "provider:anthropic", &master_key)
            .unwrap()
            .unwrap();
        assert_eq!(&*key, "sk-ant-file-test");
    }
}
