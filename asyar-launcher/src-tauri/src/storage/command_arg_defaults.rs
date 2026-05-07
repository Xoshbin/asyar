use crate::error::AppError;
use rusqlite::{params, Connection};
use std::collections::HashMap;

/// Persistence for per-command argument last-values.
///
/// Used by the launcher to pre-fill argument chip inputs with the values
/// the user most recently submitted for a given command. Passwords are
/// filtered at the service layer before calling `set()` — this module
/// stores whatever it is given, treating values as opaque strings.
///
/// Storage is a single row per `(extension_id, command_id)` with the
/// argument values encoded as a JSON object of string-to-string pairs.
/// Numeric and dropdown values are stringified by the caller. Decoding
/// them back to the declared argument type is the caller's concern.
pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS command_arg_defaults (
            extension_id TEXT NOT NULL,
            command_id   TEXT NOT NULL,
            values_json  TEXT NOT NULL,
            updated_at   INTEGER NOT NULL,
            PRIMARY KEY (extension_id, command_id)
        );
        CREATE INDEX IF NOT EXISTS idx_command_arg_defaults_extension
            ON command_arg_defaults(extension_id);",
    )
    .map_err(|e| {
        AppError::Database(format!("Failed to init command_arg_defaults table: {e}"))
    })?;
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Return the stored last-value map for `(extension_id, command_id)`,
/// or an empty map if nothing has been stored yet. An empty map is
/// also returned if the persisted JSON fails to decode — stale rows
/// from an older schema should fail quietly rather than crash the UI.
pub fn get(
    conn: &Connection,
    extension_id: &str,
    command_id: &str,
) -> Result<HashMap<String, String>, AppError> {
    let result = conn.query_row(
        "SELECT values_json FROM command_arg_defaults
         WHERE extension_id = ?1 AND command_id = ?2",
        params![extension_id, command_id],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(json) => {
            let parsed: HashMap<String, String> =
                serde_json::from_str(&json).unwrap_or_default();
            Ok(parsed)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(HashMap::new()),
        Err(e) => Err(AppError::Database(format!(
            "Failed to get command arg defaults: {e}"
        ))),
    }
}

/// Upsert the last-value map. An empty map clears the row so we don't
/// accumulate empty rows when a user wipes every field of a command.
pub fn set(
    conn: &Connection,
    extension_id: &str,
    command_id: &str,
    values: &HashMap<String, String>,
) -> Result<(), AppError> {
    if values.is_empty() {
        conn.execute(
            "DELETE FROM command_arg_defaults
             WHERE extension_id = ?1 AND command_id = ?2",
            params![extension_id, command_id],
        )
        .map_err(|e| {
            AppError::Database(format!("Failed to clear command arg defaults: {e}"))
        })?;
        return Ok(());
    }

    let json = serde_json::to_string(values).map_err(|e| {
        AppError::Database(format!("Failed to encode command arg defaults: {e}"))
    })?;

    conn.execute(
        "INSERT INTO command_arg_defaults (extension_id, command_id, values_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(extension_id, command_id) DO UPDATE SET
             values_json = excluded.values_json,
             updated_at = excluded.updated_at",
        params![extension_id, command_id, &json, now_millis()],
    )
    .map_err(|e| AppError::Database(format!("Failed to set command arg defaults: {e}")))?;
    Ok(())
}

/// Remove every persisted row for this extension — called on uninstall
/// so a reinstall doesn't leak arguments from a previous lifetime.
pub fn clear_for_extension(conn: &Connection, extension_id: &str) -> Result<u64, AppError> {
    let count = conn
        .execute(
            "DELETE FROM command_arg_defaults WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| {
            AppError::Database(format!("Failed to clear command arg defaults: {e}"))
        })?;
    Ok(count as u64)
}

/// Remove only the dynamic-namespaced rows for this extension — i.e.
/// every row whose `command_id` is prefixed `dynamic:`. Manifest command
/// rows for the same extension are preserved.
///
/// Called when an extension is disabled (the dynamic command list
/// disappears from the registry, but persisted last-values should
/// survive a re-enable).
pub fn clear_dynamic_for_extension(
    conn: &Connection,
    extension_id: &str,
) -> Result<u64, AppError> {
    let count = conn
        .execute(
            "DELETE FROM command_arg_defaults
             WHERE extension_id = ?1 AND command_id LIKE 'dynamic:%'",
            params![extension_id],
        )
        .map_err(|e| {
            AppError::Database(format!(
                "Failed to clear dynamic command arg defaults: {e}"
            ))
        })?;
    Ok(count as u64)
}

/// Remove the persisted row for one specific dynamic command id.
/// Called when a dynamic command is dropped from the registry by a
/// `replace_dynamic_commands` diff so its argument last-values do
/// not linger on disk for an id no longer registered.
pub fn clear_for_dynamic_id(
    conn: &Connection,
    extension_id: &str,
    dynamic_id: &str,
) -> Result<(), AppError> {
    let key = format!("dynamic:{dynamic_id}");
    conn.execute(
        "DELETE FROM command_arg_defaults
         WHERE extension_id = ?1 AND command_id = ?2",
        params![extension_id, key],
    )
    .map_err(|e| {
        AppError::Database(format!(
            "Failed to clear dynamic command arg defaults for {dynamic_id}: {e}"
        ))
    })?;
    Ok(())
}

/// Build the canonical `command_id` storage key for a dynamic command.
/// Manifest commands use their bare id; dynamic commands get a
/// `dynamic:` prefix so the two id spaces never collide.
pub fn dynamic_command_id_key(dynamic_id: &str) -> String {
    format!("dynamic:{dynamic_id}")
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
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='command_arg_defaults'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn get_returns_empty_when_no_row() {
        let conn = mem_conn();
        let got = get(&conn, "ext", "cmd").unwrap();
        assert!(got.is_empty());
    }

    #[test]
    fn set_and_get_roundtrip() {
        let conn = mem_conn();
        let mut values = HashMap::new();
        values.insert("query".to_string(), "hello world".to_string());
        values.insert("lang".to_string(), "es".to_string());

        set(&conn, "org.test.ext", "translate", &values).unwrap();
        let got = get(&conn, "org.test.ext", "translate").unwrap();
        assert_eq!(got, values);
    }

    #[test]
    fn set_overwrites_existing_row() {
        let conn = mem_conn();
        let mut first = HashMap::new();
        first.insert("q".to_string(), "a".to_string());
        set(&conn, "ext", "cmd", &first).unwrap();

        let mut second = HashMap::new();
        second.insert("q".to_string(), "b".to_string());
        set(&conn, "ext", "cmd", &second).unwrap();

        let got = get(&conn, "ext", "cmd").unwrap();
        assert_eq!(got.get("q").map(|s| s.as_str()), Some("b"));
        assert_eq!(got.len(), 1);
    }

    #[test]
    fn set_with_empty_map_deletes_row() {
        let conn = mem_conn();
        let mut values = HashMap::new();
        values.insert("q".to_string(), "a".to_string());
        set(&conn, "ext", "cmd", &values).unwrap();

        set(&conn, "ext", "cmd", &HashMap::new()).unwrap();
        let got = get(&conn, "ext", "cmd").unwrap();
        assert!(got.is_empty());

        let row_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM command_arg_defaults WHERE extension_id='ext'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(row_count, 0);
    }

    #[test]
    fn get_is_scoped_by_extension_and_command() {
        let conn = mem_conn();
        let mut a = HashMap::new();
        a.insert("q".to_string(), "ext-a-cmd-1".to_string());
        let mut b = HashMap::new();
        b.insert("q".to_string(), "ext-a-cmd-2".to_string());
        let mut c = HashMap::new();
        c.insert("q".to_string(), "ext-b-cmd-1".to_string());

        set(&conn, "ext-a", "cmd-1", &a).unwrap();
        set(&conn, "ext-a", "cmd-2", &b).unwrap();
        set(&conn, "ext-b", "cmd-1", &c).unwrap();

        assert_eq!(get(&conn, "ext-a", "cmd-1").unwrap().get("q").unwrap(), "ext-a-cmd-1");
        assert_eq!(get(&conn, "ext-a", "cmd-2").unwrap().get("q").unwrap(), "ext-a-cmd-2");
        assert_eq!(get(&conn, "ext-b", "cmd-1").unwrap().get("q").unwrap(), "ext-b-cmd-1");
    }

    #[test]
    fn clear_for_extension_removes_all_rows_for_that_extension() {
        let conn = mem_conn();
        let mut v = HashMap::new();
        v.insert("k".to_string(), "v".to_string());
        set(&conn, "ext-a", "cmd-1", &v).unwrap();
        set(&conn, "ext-a", "cmd-2", &v).unwrap();
        set(&conn, "ext-b", "cmd-1", &v).unwrap();

        let removed = clear_for_extension(&conn, "ext-a").unwrap();
        assert_eq!(removed, 2);

        assert!(get(&conn, "ext-a", "cmd-1").unwrap().is_empty());
        assert!(get(&conn, "ext-a", "cmd-2").unwrap().is_empty());
        assert_eq!(
            get(&conn, "ext-b", "cmd-1").unwrap().get("k").map(|s| s.as_str()),
            Some("v")
        );
    }

    #[test]
    fn corrupt_json_decodes_to_empty_map_without_error() {
        let conn = mem_conn();
        conn.execute(
            "INSERT INTO command_arg_defaults (extension_id, command_id, values_json, updated_at)
             VALUES ('ext', 'cmd', 'not-json', 1)",
            [],
        )
        .unwrap();
        let got = get(&conn, "ext", "cmd").unwrap();
        assert!(got.is_empty());
    }

    fn count_rows(conn: &Connection, extension_id: &str) -> i64 {
        conn.query_row(
            "SELECT count(*) FROM command_arg_defaults WHERE extension_id = ?1",
            params![extension_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn dynamic_command_id_key_prefixes_with_dynamic() {
        assert_eq!(dynamic_command_id_key("uuid-1"), "dynamic:uuid-1");
    }

    #[test]
    fn clear_dynamic_for_extension_removes_only_dynamic_rows() {
        let conn = mem_conn();
        let mut v = HashMap::new();
        v.insert("k".to_string(), "v".to_string());

        // Manifest command row
        set(&conn, "ext", "open", &v).unwrap();
        // Dynamic command rows
        set(&conn, "ext", "dynamic:abc", &v).unwrap();
        set(&conn, "ext", "dynamic:xyz", &v).unwrap();

        let removed = clear_dynamic_for_extension(&conn, "ext").unwrap();
        assert_eq!(removed, 2);

        // Manifest row preserved
        assert_eq!(count_rows(&conn, "ext"), 1);
        let got = get(&conn, "ext", "open").unwrap();
        assert_eq!(got.get("k").map(|s| s.as_str()), Some("v"));
    }

    #[test]
    fn clear_dynamic_for_extension_returns_zero_when_no_dynamic_rows() {
        let conn = mem_conn();
        let mut v = HashMap::new();
        v.insert("k".to_string(), "v".to_string());
        set(&conn, "ext", "open", &v).unwrap();

        let removed = clear_dynamic_for_extension(&conn, "ext").unwrap();
        assert_eq!(removed, 0);
        assert_eq!(count_rows(&conn, "ext"), 1);
    }

    #[test]
    fn clear_dynamic_for_extension_does_not_affect_other_extensions() {
        let conn = mem_conn();
        let mut v = HashMap::new();
        v.insert("k".to_string(), "v".to_string());
        set(&conn, "ext-a", "dynamic:1", &v).unwrap();
        set(&conn, "ext-b", "dynamic:1", &v).unwrap();

        let removed = clear_dynamic_for_extension(&conn, "ext-a").unwrap();
        assert_eq!(removed, 1);
        assert_eq!(count_rows(&conn, "ext-a"), 0);
        assert_eq!(count_rows(&conn, "ext-b"), 1);
    }

    #[test]
    fn clear_for_dynamic_id_removes_specific_dynamic_row() {
        let conn = mem_conn();
        let mut v = HashMap::new();
        v.insert("k".to_string(), "v".to_string());
        set(&conn, "ext", &dynamic_command_id_key("a"), &v).unwrap();
        set(&conn, "ext", &dynamic_command_id_key("b"), &v).unwrap();

        clear_for_dynamic_id(&conn, "ext", "a").unwrap();

        assert!(get(&conn, "ext", &dynamic_command_id_key("a"))
            .unwrap()
            .is_empty());
        assert_eq!(
            get(&conn, "ext", &dynamic_command_id_key("b"))
                .unwrap()
                .get("k")
                .map(|s| s.as_str()),
            Some("v")
        );
    }

    #[test]
    fn clear_for_dynamic_id_idempotent_when_no_row() {
        let conn = mem_conn();
        // Should not error when nothing to delete.
        clear_for_dynamic_id(&conn, "ext", "missing").unwrap();
    }

    #[test]
    fn manifest_id_open_does_not_collide_with_dynamic_id_open() {
        // Sanity check: a manifest command 'open' and a dynamic command
        // with id 'open' (registered as 'dynamic:open') store
        // independently; one cannot clobber the other.
        let conn = mem_conn();
        let mut a = HashMap::new();
        a.insert("from".to_string(), "manifest".to_string());
        let mut b = HashMap::new();
        b.insert("from".to_string(), "dynamic".to_string());

        set(&conn, "ext", "open", &a).unwrap();
        set(&conn, "ext", &dynamic_command_id_key("open"), &b).unwrap();

        assert_eq!(
            get(&conn, "ext", "open").unwrap().get("from").map(|s| s.as_str()),
            Some("manifest")
        );
        assert_eq!(
            get(&conn, "ext", &dynamic_command_id_key("open"))
                .unwrap()
                .get("from")
                .map(|s| s.as_str()),
            Some("dynamic")
        );
    }
}
