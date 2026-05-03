use crate::crypto::cipher;
use crate::error::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceBundle {
    pub extension: HashMap<String, serde_json::Value>,
    pub commands: HashMap<String, HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceExportRow {
    pub extension_id: String,
    pub command_id: Option<String>,
    pub key: String,
    pub value: String,
    pub is_encrypted: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreferencesExport {
    pub rows: Vec<PreferenceExportRow>,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    // SQLite PRIMARY KEY constraints reject expressions, so we use an empty
    // string as the sentinel for "extension-level preference" instead of NULL.
    // The TS-facing command_id field stays Option<String>: we map None <-> ""
    // at the storage boundary.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS extension_preferences (
            extension_id TEXT NOT NULL,
            command_id   TEXT NOT NULL DEFAULT '',
            key          TEXT NOT NULL,
            value        TEXT NOT NULL,
            is_encrypted INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL,
            PRIMARY KEY (extension_id, command_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_ext_prefs_extension
            ON extension_preferences(extension_id);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init extension_preferences table: {e}")))?;
    Ok(())
}

/// Convert an optional command id into the storage sentinel.
/// None = extension-level preference → empty string.
fn cmd_id_for_storage(command_id: Option<&str>) -> &str {
    command_id.unwrap_or("")
}

/// Convert the storage sentinel back to an optional command id.
/// Empty string → None, any non-empty value → Some.
fn cmd_id_from_storage(raw: String) -> Option<String> {
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn set(
    conn: &Connection,
    extension_id: &str,
    command_id: Option<&str>,
    key: &str,
    value: &str,
    is_encrypted: bool,
    master_key: &[u8; 32],
) -> Result<(), AppError> {
    let stored_value = if is_encrypted {
        cipher::encrypt(value, master_key)?
    } else {
        value.to_string()
    };

    let cmd = cmd_id_for_storage(command_id);
    conn.execute(
        "INSERT INTO extension_preferences (extension_id, command_id, key, value, is_encrypted, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(extension_id, command_id, key) DO UPDATE SET
             value = excluded.value,
             is_encrypted = excluded.is_encrypted,
             updated_at = excluded.updated_at",
        params![
            extension_id,
            cmd,
            key,
            &stored_value,
            if is_encrypted { 1 } else { 0 },
            now_millis()
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to set preference: {e}")))?;
    Ok(())
}

pub fn get(
    conn: &Connection,
    extension_id: &str,
    command_id: Option<&str>,
    key: &str,
    master_key: &[u8; 32],
) -> Result<Option<(String, bool)>, AppError> {
    let cmd = cmd_id_for_storage(command_id);
    let result = conn.query_row(
        "SELECT value, is_encrypted FROM extension_preferences
         WHERE extension_id = ?1 AND command_id = ?2 AND key = ?3",
        params![extension_id, cmd, key],
        |row| {
            let v: String = row.get(0)?;
            let e: i64 = row.get(1)?;
            Ok((v, e != 0))
        },
    );
    match result {
        Ok((stored, encrypted)) => {
            if encrypted {
                // Pre-Layer-3 rows produced by the legacy hardcoded
                // scheme cannot be decrypted under the new keystore key.
                // Treat as missing — the extension's preference UI will
                // re-prompt the user (per beta-phase clean break).
                match cipher::decrypt(&stored, master_key) {
                    Ok(plaintext) => Ok(Some((plaintext, true))),
                    Err(e) => {
                        log::debug!(
                            "ext_prefs decrypt failed (extension_id={extension_id}, key={key}): {e}; \
                             treating as missing"
                        );
                        Ok(None)
                    }
                }
            } else {
                Ok(Some((stored, false)))
            }
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(format!("Failed to get preference: {e}"))),
    }
}

pub fn get_all_for_extension(
    conn: &Connection,
    extension_id: &str,
    master_key: &[u8; 32],
) -> Result<Vec<PreferenceExportRow>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT extension_id, command_id, key, value, is_encrypted, updated_at
             FROM extension_preferences WHERE extension_id = ?1",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare prefs query: {e}")))?;
    let raw_rows: Vec<PreferenceExportRow> = stmt
        .query_map(params![extension_id], |row| {
            let cmd_raw: String = row.get(1)?;
            Ok(PreferenceExportRow {
                extension_id: row.get(0)?,
                command_id: cmd_id_from_storage(cmd_raw),
                key: row.get(2)?,
                value: row.get(3)?,
                is_encrypted: row.get::<_, i64>(4)? != 0,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| AppError::Database(format!("Failed to query prefs: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    // Decrypt encrypted rows so callers always see plaintext. Encrypted rows
    // never leave the device via export_all (which filters them at the SQL
    // layer), so this decryption only runs for host-local reads.
    //
    // Rows that fail to decrypt (e.g. pre-Layer-3 legacy `enc:aes256gcm:`
    // ciphertext under a now-removed hardcoded key) are silently dropped
    // from the result so the extension UI re-prompts on next read.
    let mut decrypted_rows = Vec::with_capacity(raw_rows.len());
    for mut row in raw_rows {
        if row.is_encrypted {
            match cipher::decrypt(&row.value, master_key) {
                Ok(plaintext) => row.value = plaintext,
                Err(e) => {
                    log::debug!(
                        "ext_prefs decrypt failed (extension_id={}, key={}): {e}; dropping row",
                        row.extension_id,
                        row.key
                    );
                    continue;
                }
            }
        }
        decrypted_rows.push(row);
    }
    Ok(decrypted_rows)
}

pub fn delete(
    conn: &Connection,
    extension_id: &str,
    command_id: Option<&str>,
    key: &str,
) -> Result<bool, AppError> {
    let cmd = cmd_id_for_storage(command_id);
    let count = conn
        .execute(
            "DELETE FROM extension_preferences
             WHERE extension_id = ?1 AND command_id = ?2 AND key = ?3",
            params![extension_id, cmd, key],
        )
        .map_err(|e| AppError::Database(format!("Failed to delete preference: {e}")))?;
    Ok(count > 0)
}

pub fn clear(conn: &Connection, extension_id: &str) -> Result<u64, AppError> {
    let count = conn
        .execute(
            "DELETE FROM extension_preferences WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| AppError::Database(format!("Failed to clear preferences: {e}")))?;
    Ok(count as u64)
}

pub fn export_all(conn: &Connection) -> Result<PreferencesExport, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT extension_id, command_id, key, value, is_encrypted, updated_at
             FROM extension_preferences WHERE is_encrypted = 0",
        )
        .map_err(|e| AppError::Database(format!("Failed to prepare export query: {e}")))?;
    let rows = stmt
        .query_map([], |row| {
            let cmd_raw: String = row.get(1)?;
            Ok(PreferenceExportRow {
                extension_id: row.get(0)?,
                command_id: cmd_id_from_storage(cmd_raw),
                key: row.get(2)?,
                value: row.get(3)?,
                is_encrypted: row.get::<_, i64>(4)? != 0,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| AppError::Database(format!("Failed to query export: {e}")))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(PreferencesExport { rows })
}

#[derive(Debug, Clone, Copy)]
pub enum ImportStrategy {
    Replace,
    Merge,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub items_added: u64,
    pub items_updated: u64,
    pub items_skipped: u64,
}

pub fn import_all(
    conn: &Connection,
    incoming: PreferencesExport,
    strategy: ImportStrategy,
    master_key: &[u8; 32],
) -> Result<ImportResult, AppError> {
    let mut added = 0u64;
    let mut updated = 0u64;
    let mut skipped = 0u64;
    for row in incoming.rows {
        if row.is_encrypted {
            skipped += 1;
            continue; // never import encrypted rows — device-local only
        }
        let existing = get(
            conn,
            &row.extension_id,
            row.command_id.as_deref(),
            &row.key,
            master_key,
        )?;
        match (existing, strategy) {
            (Some(_), ImportStrategy::Merge) => {
                skipped += 1;
            }
            (Some(_), ImportStrategy::Replace) => {
                set(
                    conn,
                    &row.extension_id,
                    row.command_id.as_deref(),
                    &row.key,
                    &row.value,
                    false,
                    master_key,
                )?;
                updated += 1;
            }
            (None, _) => {
                set(
                    conn,
                    &row.extension_id,
                    row.command_id.as_deref(),
                    &row.key,
                    &row.value,
                    false,
                    master_key,
                )?;
                added += 1;
            }
        }
    }
    Ok(ImportResult {
        items_added: added,
        items_updated: updated,
        items_skipped: skipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    fn test_key() -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = (i * 5) as u8;
        }
        k
    }

    #[test]
    fn init_creates_table() {
        let conn = mem_conn();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='extension_preferences'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn set_and_get_extension_level() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "units", "\"metric\"", false, &key).unwrap();
        let got = get(&conn, "ext1", None, "units", &key).unwrap();
        assert_eq!(got, Some(("\"metric\"".to_string(), false)));
    }

    #[test]
    fn set_and_get_command_level() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", Some("forecast"), "days", "5", false, &key).unwrap();
        let got = get(&conn, "ext1", Some("forecast"), "days", &key).unwrap();
        assert_eq!(got, Some(("5".to_string(), false)));

        // Extension-level get for same key returns None
        assert!(get(&conn, "ext1", None, "days", &key).unwrap().is_none());
    }

    #[test]
    fn set_upserts_existing_row() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "k", "\"a\"", false, &key).unwrap();
        set(&conn, "ext1", None, "k", "\"b\"", false, &key).unwrap();
        assert_eq!(
            get(&conn, "ext1", None, "k", &key).unwrap(),
            Some(("\"b\"".to_string(), false))
        );
    }

    #[test]
    fn is_encrypted_flag_persists() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "secret", "abc", true, &key).unwrap();
        set(&conn, "ext1", None, "plain", "def", false, &key).unwrap();
        assert!(get(&conn, "ext1", None, "secret", &key).unwrap().unwrap().1);
        assert!(!get(&conn, "ext1", None, "plain", &key).unwrap().unwrap().1);
    }

    #[test]
    fn encrypted_values_roundtrip_plaintext_through_set_and_get() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "api_key", "sk-plaintext-secret", true, &key).unwrap();

        let raw: String = conn
            .query_row(
                "SELECT value FROM extension_preferences WHERE extension_id = 'ext1' AND key = 'api_key'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(raw, "sk-plaintext-secret", "value column must NOT contain plaintext");
        assert!(raw.starts_with(cipher::VERSION_PREFIX), "must use enc:v1: scheme");

        let got = get(&conn, "ext1", None, "api_key", &key).unwrap();
        assert_eq!(got, Some(("sk-plaintext-secret".to_string(), true)));
    }

    #[test]
    fn get_returns_none_for_undecryptable_legacy_row() {
        // Simulate a pre-Layer-3 row produced by the old hardcoded key
        // by inserting a non-`enc:v1:` value with is_encrypted = 1.
        let conn = mem_conn();
        conn.execute(
            "INSERT INTO extension_preferences
                (extension_id, command_id, key, value, is_encrypted, updated_at)
             VALUES ('ext1', '', 'legacy', 'enc:aes256gcm:bm9wZQ==', 1, 1)",
            [],
        )
        .unwrap();

        let key = test_key();
        let got = get(&conn, "ext1", None, "legacy", &key).unwrap();
        assert!(got.is_none(), "legacy row must surface as missing");
    }

    #[test]
    fn get_all_for_extension_returns_decrypted_password_values() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "plain", "\"v\"", false, &key).unwrap();
        set(&conn, "ext1", None, "secret", "sk-abc", true, &key).unwrap();

        let rows = get_all_for_extension(&conn, "ext1", &key).unwrap();
        let secret_row = rows.iter().find(|r| r.key == "secret").unwrap();
        assert_eq!(secret_row.value, "sk-abc", "get_all must return decrypted plaintext");
        assert!(secret_row.is_encrypted);
    }

    #[test]
    fn get_all_for_extension_drops_undecryptable_legacy_rows() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "plain", "\"v\"", false, &key).unwrap();
        // Legacy row that won't decrypt.
        conn.execute(
            "INSERT INTO extension_preferences
                (extension_id, command_id, key, value, is_encrypted, updated_at)
             VALUES ('ext1', '', 'legacy', 'enc:aes256gcm:bm9wZQ==', 1, 1)",
            [],
        )
        .unwrap();

        let rows = get_all_for_extension(&conn, "ext1", &key).unwrap();
        assert_eq!(rows.len(), 1, "legacy row dropped, only the plain row survives");
        assert_eq!(rows[0].key, "plain");
    }

    #[test]
    fn get_all_for_extension_returns_both_levels() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "units", "\"metric\"", false, &key).unwrap();
        set(&conn, "ext1", Some("forecast"), "days", "5", false, &key).unwrap();
        set(&conn, "ext2", None, "k", "1", false, &key).unwrap();

        let rows = get_all_for_extension(&conn, "ext1", &key).unwrap();
        assert_eq!(rows.len(), 2);
        let keys: Vec<_> = rows.iter().map(|r| (r.command_id.clone(), r.key.clone())).collect();
        assert!(keys.contains(&(None, "units".to_string())));
        assert!(keys.contains(&(Some("forecast".to_string()), "days".to_string())));
    }

    #[test]
    fn delete_removes_single_row() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "k", "1", false, &key).unwrap();
        assert!(delete(&conn, "ext1", None, "k").unwrap());
        assert!(get(&conn, "ext1", None, "k", &key).unwrap().is_none());
        assert!(!delete(&conn, "ext1", None, "k").unwrap());
    }

    #[test]
    fn clear_removes_all_rows_for_extension() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "a", "1", false, &key).unwrap();
        set(&conn, "ext1", Some("cmd"), "b", "2", false, &key).unwrap();
        set(&conn, "ext2", None, "c", "3", false, &key).unwrap();

        let removed = clear(&conn, "ext1").unwrap();
        assert_eq!(removed, 2);
        assert!(get_all_for_extension(&conn, "ext1", &key).unwrap().is_empty());
        assert_eq!(get_all_for_extension(&conn, "ext2", &key).unwrap().len(), 1);
    }

    #[test]
    fn export_all_excludes_encrypted_rows() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "plain", "\"v\"", false, &key).unwrap();
        set(&conn, "ext1", None, "secret", "cipher", true, &key).unwrap();

        let export = export_all(&conn).unwrap();
        assert_eq!(export.rows.len(), 1);
        assert_eq!(export.rows[0].key, "plain");
    }

    #[test]
    fn import_all_replace_strategy_overwrites_local() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "k", "\"old\"", false, &key).unwrap();

        let incoming = PreferencesExport {
            rows: vec![PreferenceExportRow {
                extension_id: "ext1".to_string(),
                command_id: None,
                key: "k".to_string(),
                value: "\"new\"".to_string(),
                is_encrypted: false,
                updated_at: 1,
            }],
        };
        let result = import_all(&conn, incoming, ImportStrategy::Replace, &key).unwrap();
        assert_eq!(result.items_updated, 1);
        assert_eq!(
            get(&conn, "ext1", None, "k", &key).unwrap(),
            Some(("\"new\"".to_string(), false))
        );
    }

    #[test]
    fn import_all_merge_strategy_keeps_local() {
        let conn = mem_conn();
        let key = test_key();
        set(&conn, "ext1", None, "k", "\"local\"", false, &key).unwrap();

        let incoming = PreferencesExport {
            rows: vec![
                PreferenceExportRow {
                    extension_id: "ext1".to_string(),
                    command_id: None,
                    key: "k".to_string(),
                    value: "\"remote\"".to_string(),
                    is_encrypted: false,
                    updated_at: 1,
                },
                PreferenceExportRow {
                    extension_id: "ext1".to_string(),
                    command_id: None,
                    key: "added".to_string(),
                    value: "\"hi\"".to_string(),
                    is_encrypted: false,
                    updated_at: 1,
                },
            ],
        };
        let result = import_all(&conn, incoming, ImportStrategy::Merge, &key).unwrap();
        assert_eq!(result.items_added, 1);
        assert_eq!(result.items_updated, 0);
        assert_eq!(
            get(&conn, "ext1", None, "k", &key).unwrap(),
            Some(("\"local\"".to_string(), false))
        );
        assert_eq!(
            get(&conn, "ext1", None, "added", &key).unwrap(),
            Some(("\"hi\"".to_string(), false))
        );
    }
}
