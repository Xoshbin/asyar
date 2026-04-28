use crate::error::AppError;
use crate::profile::encryption::{decrypt_value, encrypt_value};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Device-local key material for encrypting password-type preferences.
/// Defense-in-depth against casual file reading, matching the pattern in
/// auth/token_store.rs::machine_key. Not a cryptographic secret.
fn prefs_key_material() -> (String, Vec<u8>) {
    let password = "asyar-extension-preferences-v1".to_string();
    let salt = b"asyar-ext-prefs-salt-v1".to_vec();
    (password, salt)
}

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
) -> Result<(), AppError> {
    let stored_value = if is_encrypted {
        let (pw, salt) = prefs_key_material();
        encrypt_value(value, &pw, &salt)?
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
                let (pw, salt) = prefs_key_material();
                let plaintext = decrypt_value(&stored, &pw, &salt)?;
                Ok(Some((plaintext, true)))
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
    let (pw, salt) = prefs_key_material();
    let mut decrypted_rows = Vec::with_capacity(raw_rows.len());
    for mut row in raw_rows {
        if row.is_encrypted {
            row.value = decrypt_value(&row.value, &pw, &salt)?;
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
) -> Result<ImportResult, AppError> {
    let mut added = 0u64;
    let mut updated = 0u64;
    let mut skipped = 0u64;
    for row in incoming.rows {
        if row.is_encrypted {
            skipped += 1;
            continue; // never import encrypted rows — device-local only
        }
        let existing = get(conn, &row.extension_id, row.command_id.as_deref(), &row.key)?;
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
        set(&conn, "ext1", None, "units", "\"metric\"", false).unwrap();
        let got = get(&conn, "ext1", None, "units").unwrap();
        assert_eq!(got, Some(("\"metric\"".to_string(), false)));
    }

    #[test]
    fn set_and_get_command_level() {
        let conn = mem_conn();
        set(&conn, "ext1", Some("forecast"), "days", "5", false).unwrap();
        let got = get(&conn, "ext1", Some("forecast"), "days").unwrap();
        assert_eq!(got, Some(("5".to_string(), false)));

        // Extension-level get for same key returns None
        assert!(get(&conn, "ext1", None, "days").unwrap().is_none());
    }

    #[test]
    fn set_upserts_existing_row() {
        let conn = mem_conn();
        set(&conn, "ext1", None, "k", "\"a\"", false).unwrap();
        set(&conn, "ext1", None, "k", "\"b\"", false).unwrap();
        assert_eq!(
            get(&conn, "ext1", None, "k").unwrap(),
            Some(("\"b\"".to_string(), false))
        );
    }

    #[test]
    fn is_encrypted_flag_persists() {
        let conn = mem_conn();
        set(&conn, "ext1", None, "secret", "abc", true).unwrap();
        set(&conn, "ext1", None, "plain", "def", false).unwrap();
        assert!(get(&conn, "ext1", None, "secret").unwrap().unwrap().1);
        assert!(!get(&conn, "ext1", None, "plain").unwrap().unwrap().1);
    }

    #[test]
    fn encrypted_values_roundtrip_plaintext_through_set_and_get() {
        let conn = mem_conn();
        // Caller passes plaintext. Storage encrypts before insert.
        set(&conn, "ext1", None, "api_key", "sk-plaintext-secret", true).unwrap();

        // The raw DB column must contain ciphertext, not plaintext.
        let raw: String = conn
            .query_row(
                "SELECT value FROM extension_preferences WHERE extension_id = 'ext1' AND key = 'api_key'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(raw, "sk-plaintext-secret", "value column must NOT contain plaintext");

        // get() returns the decrypted plaintext.
        let got = get(&conn, "ext1", None, "api_key").unwrap();
        assert_eq!(got, Some(("sk-plaintext-secret".to_string(), true)));
    }

    #[test]
    fn get_all_for_extension_returns_decrypted_password_values() {
        let conn = mem_conn();
        set(&conn, "ext1", None, "plain", "\"v\"", false).unwrap();
        set(&conn, "ext1", None, "secret", "sk-abc", true).unwrap();

        let rows = get_all_for_extension(&conn, "ext1").unwrap();
        let secret_row = rows.iter().find(|r| r.key == "secret").unwrap();
        assert_eq!(secret_row.value, "sk-abc", "get_all must return decrypted plaintext");
        assert!(secret_row.is_encrypted);
    }

    #[test]
    fn get_all_for_extension_returns_both_levels() {
        let conn = mem_conn();
        set(&conn, "ext1", None, "units", "\"metric\"", false).unwrap();
        set(&conn, "ext1", Some("forecast"), "days", "5", false).unwrap();
        set(&conn, "ext2", None, "k", "1", false).unwrap();

        let rows = get_all_for_extension(&conn, "ext1").unwrap();
        assert_eq!(rows.len(), 2);
        let keys: Vec<_> = rows.iter().map(|r| (r.command_id.clone(), r.key.clone())).collect();
        assert!(keys.contains(&(None, "units".to_string())));
        assert!(keys.contains(&(Some("forecast".to_string()), "days".to_string())));
    }

    #[test]
    fn delete_removes_single_row() {
        let conn = mem_conn();
        set(&conn, "ext1", None, "k", "1", false).unwrap();
        assert!(delete(&conn, "ext1", None, "k").unwrap());
        assert!(get(&conn, "ext1", None, "k").unwrap().is_none());
        assert!(!delete(&conn, "ext1", None, "k").unwrap());
    }

    #[test]
    fn clear_removes_all_rows_for_extension() {
        let conn = mem_conn();
        set(&conn, "ext1", None, "a", "1", false).unwrap();
        set(&conn, "ext1", Some("cmd"), "b", "2", false).unwrap();
        set(&conn, "ext2", None, "c", "3", false).unwrap();

        let removed = clear(&conn, "ext1").unwrap();
        assert_eq!(removed, 2);
        assert!(get_all_for_extension(&conn, "ext1").unwrap().is_empty());
        assert_eq!(get_all_for_extension(&conn, "ext2").unwrap().len(), 1);
    }

    #[test]
    fn export_all_excludes_encrypted_rows() {
        let conn = mem_conn();
        set(&conn, "ext1", None, "plain", "\"v\"", false).unwrap();
        set(&conn, "ext1", None, "secret", "cipher", true).unwrap();

        let export = export_all(&conn).unwrap();
        assert_eq!(export.rows.len(), 1);
        assert_eq!(export.rows[0].key, "plain");
    }

    #[test]
    fn import_all_replace_strategy_overwrites_local() {
        let conn = mem_conn();
        set(&conn, "ext1", None, "k", "\"old\"", false).unwrap();

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
        let result = import_all(&conn, incoming, ImportStrategy::Replace).unwrap();
        assert_eq!(result.items_updated, 1);
        assert_eq!(
            get(&conn, "ext1", None, "k").unwrap(),
            Some(("\"new\"".to_string(), false))
        );
    }

    #[test]
    fn import_all_merge_strategy_keeps_local() {
        let conn = mem_conn();
        set(&conn, "ext1", None, "k", "\"local\"", false).unwrap();

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
        let result = import_all(&conn, incoming, ImportStrategy::Merge).unwrap();
        assert_eq!(result.items_added, 1);
        assert_eq!(result.items_updated, 0);
        assert_eq!(
            get(&conn, "ext1", None, "k").unwrap(),
            Some(("\"local\"".to_string(), false))
        );
        assert_eq!(
            get(&conn, "ext1", None, "added").unwrap(),
            Some(("\"hi\"".to_string(), false))
        );
    }
}
