//! Ordered, versioned schema ledger for `asyar_data.db`.
//!
//! `PRAGMA user_version` records how far a database has been migrated.
//! [`run`] applies every ledger entry above that mark, in order, each in its
//! own transaction, and is the *only* way the schema is created — both
//! `DataStore::initialize` and `create_test_store` go through it, so the two
//! can no longer drift apart.
//!
//! ## Adding a migration
//!
//! Append one `Migration` to [`MIGRATIONS`] with the next version number and a
//! plain forward-only `up`. Never edit or reorder a published entry: databases
//! in the field are already stamped with it and will not replay it.

use crate::error::AppError;
use rusqlite::Connection;

pub struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub up: fn(&Connection) -> Result<(), AppError>,
}

/// Append-only. Versions start at 1 and must stay gapless and strictly
/// ascending — `ledger_versions_are_unique_ascending_and_gapless_from_one`
/// enforces that so two contributors cannot both claim the same number.
pub const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "baseline",
    up: baseline,
}];

/// Bring `conn` up to the newest ledger version. Idempotent.
pub fn run(conn: &Connection) -> Result<(), AppError> {
    run_ledger(conn, MIGRATIONS)
}

fn run_ledger(conn: &Connection, ledger: &[Migration]) -> Result<(), AppError> {
    let current = user_version(conn)?;

    for migration in ledger.iter().filter(|m| m.version > current) {
        // `unchecked_transaction` is what lets this take `&Connection`: the
        // store hands out shared handles, not the `&mut` a normal transaction
        // needs. Dropping without commit rolls back, so a failing `up` leaves
        // both the schema and `user_version` untouched.
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| AppError::Database(format!("migration transaction failed: {e}")))?;

        (migration.up)(&tx).map_err(|e| {
            AppError::Database(format!(
                "migration {} ({}) failed: {e}",
                migration.version, migration.name
            ))
        })?;

        tx.execute_batch(&format!("PRAGMA user_version = {};", migration.version))
            .map_err(|e| {
                AppError::Database(format!(
                    "failed to stamp user_version {}: {e}",
                    migration.version
                ))
            })?;

        tx.commit().map_err(|e| {
            AppError::Database(format!(
                "migration {} commit failed: {e}",
                migration.version
            ))
        })?;
    }

    Ok(())
}

fn user_version(conn: &Connection) -> Result<u32, AppError> {
    conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map(|v| v as u32)
        .map_err(|e| AppError::Database(format!("failed to read user_version: {e}")))
}

/// Version 1 — the shape every database had before the ledger existed.
///
/// Existing installs sit at `user_version = 0` with a fully populated schema,
/// so this step has to be a no-op against them rather than a rebuild: each
/// `init_table` is `CREATE TABLE IF NOT EXISTS` plus its own column guards,
/// which recognises an old database and stamps it as version 1 without
/// touching a single row. Fresh installs reach the same schema by the same
/// path. Migrations from 2 onward are plain forward-only SQL.
fn baseline(conn: &Connection) -> Result<(), AppError> {
    use super::*;

    let sqlite = |e: rusqlite::Error| AppError::Database(e.to_string());

    clipboard::init_table(conn)?;
    snippets::init_table(conn)?;
    notes::init_table(conn)?;
    sticky_notes::init_table(conn)?;
    shortcuts::init_table(conn)?;
    extension_kv::init_table(conn)?;
    extension_preferences::init_table(conn)?;
    extension_cache::init_table(conn)?;
    extension_state::init_table(conn)?;
    shell::init_table(conn)?;
    timers::init_table(conn)?;
    command_arg_defaults::init_table(conn)?;
    searchbar_accessory::init_table(conn)?;
    cloud_sync_state::init_table(conn)?;
    cloud_sync_e2ee_local::init_table(conn)?;
    runs_history::init_table(conn)?;
    script_directories::init_table(conn)?;
    file_search_selections::init_table(conn).map_err(sqlite)?;
    file_search_pinned::init_table(conn).map_err(sqlite)?;
    agents::init_table(conn)?;
    mcp_servers::init_table(conn)?;
    mcp_audit::init_table(conn)?;
    mcp_permissions::init_table(conn)?;
    mcp_settings::init_table(conn)?;
    crate::aliases::init_table(conn).map_err(sqlite)?;
    crate::oauth::token_store::init_table(conn)?;
    crate::extensions::onboarding_state::init_table(conn)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every table `asyar_data.db` is expected to hold after a full ledger run.
    /// Sorted; compared as a whole so an accidental add or drop fails loudly.
    const EXPECTED_TABLES: &[&str] = &[
        "agents",
        "clipboard_items",
        "cloud_sync_cursor",
        "cloud_sync_e2ee_local",
        "cloud_sync_items_journal",
        "command_arg_defaults",
        "extension_cache",
        "extension_onboarding",
        "extension_preferences",
        "extension_state",
        "extension_storage",
        "extension_timers",
        "file_search_pinned",
        "file_search_selections",
        "item_aliases",
        "mcp_audit",
        "mcp_permissions",
        "mcp_servers",
        "mcp_settings",
        "messages",
        "notes",
        "oauth_tokens",
        "runs_history",
        "script_directories",
        "searchbar_accessory_state",
        "shell_trusted_binaries",
        "shortcuts",
        "snippets",
        "sticky_notes",
        "threads",
    ];

    fn user_version(conn: &Connection) -> u32 {
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap() as u32
    }

    fn names_of(conn: &Connection, kind: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = ?1 AND name NOT LIKE 'sqlite_%'
                 ORDER BY name",
            )
            .unwrap();
        stmt.query_map([kind], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    /// Full `sqlite_master` fingerprint (tables *and* indexes, with their SQL),
    /// normalized so two databases built by different paths compare equal.
    fn schema_fingerprint(conn: &Connection) -> Vec<(String, String, String)> {
        let mut stmt = conn
            .prepare(
                "SELECT type, name, COALESCE(sql, '') FROM sqlite_master
                 WHERE name NOT LIKE 'sqlite_%'
                 ORDER BY type, name",
            )
            .unwrap();
        let mut rows: Vec<(String, String, String)> = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .map(|(t, n, sql)| (t, n, sql.split_whitespace().collect::<Vec<_>>().join(" ")))
            .collect();
        rows.sort();
        rows
    }

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn fresh_db_gets_full_schema_and_latest_version() {
        let conn = Connection::open_in_memory().unwrap();

        run(&conn).unwrap();

        assert_eq!(names_of(&conn, "table"), EXPECTED_TABLES);
        assert_eq!(
            user_version(&conn),
            MIGRATIONS.last().unwrap().version,
            "fresh DB must land on the newest ledger version"
        );
    }

    #[test]
    fn legacy_db_keeps_its_rows_and_gets_stamped() {
        let conn = Connection::open_in_memory().unwrap();

        // A pre-ledger install: populated schema, user_version still 0, and
        // missing the columns the per-module sniffs used to patch in.
        conn.execute_batch(
            "CREATE TABLE snippets (
                id TEXT PRIMARY KEY,
                keyword TEXT,
                expansion TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at REAL NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE clipboard_items (
                id TEXT PRIMARY KEY,
                item_type TEXT NOT NULL,
                content TEXT,
                preview TEXT,
                created_at REAL NOT NULL,
                favorite INTEGER NOT NULL DEFAULT 0,
                metadata TEXT
            );
            INSERT INTO snippets (id, keyword, expansion, name, created_at, pinned)
                VALUES ('s1', ':sig', 'ciphertext', 'Signature', 1.0, 0);
            INSERT INTO clipboard_items (id, item_type, content, preview, created_at, favorite)
                VALUES ('c1', 'text', 'ciphertext', 'prev', 2.0, 1);",
        )
        .unwrap();
        assert_eq!(user_version(&conn), 0);

        run(&conn).unwrap();

        let expansion: String = conn
            .query_row("SELECT expansion FROM snippets WHERE id = 's1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            expansion, "ciphertext",
            "existing user data must survive the baseline migration untouched"
        );
        let clip: String = conn
            .query_row(
                "SELECT content FROM clipboard_items WHERE id = 'c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(clip, "ciphertext");

        assert!(column_names(&conn, "snippets").contains(&"redacted_kinds".to_string()));
        assert!(column_names(&conn, "clipboard_items").contains(&"content_hash".to_string()));
        assert_eq!(names_of(&conn, "table"), EXPECTED_TABLES);
        assert_eq!(user_version(&conn), MIGRATIONS.last().unwrap().version);
    }

    #[test]
    fn run_twice_changes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let before = schema_fingerprint(&conn);
        let version_before = user_version(&conn);

        run(&conn).unwrap();

        assert_eq!(schema_fingerprint(&conn), before);
        assert_eq!(user_version(&conn), version_before);
    }

    #[test]
    fn ledger_versions_are_unique_ascending_and_gapless_from_one() {
        assert!(!MIGRATIONS.is_empty(), "ledger must not be empty");
        for (i, m) in MIGRATIONS.iter().enumerate() {
            assert_eq!(
                m.version,
                i as u32 + 1,
                "migration {:?} has version {} but must be {} — versions start at 1, \
                 ascend strictly, and leave no gaps",
                m.name,
                m.version,
                i + 1
            );
            assert!(!m.name.is_empty(), "migration {} needs a name", m.version);
        }
    }

    #[test]
    fn failing_migration_rolls_back_schema_and_version() {
        fn creates_probe(conn: &Connection) -> Result<(), AppError> {
            conn.execute_batch("CREATE TABLE ledger_probe (id INTEGER);")
                .map_err(|e| AppError::Database(e.to_string()))
        }
        fn creates_then_fails(conn: &Connection) -> Result<(), AppError> {
            conn.execute_batch("CREATE TABLE ledger_doomed (id INTEGER);")
                .map_err(|e| AppError::Database(e.to_string()))?;
            Err(AppError::Database("deliberate failure".into()))
        }

        let ledger = [
            Migration {
                version: 1,
                name: "probe",
                up: creates_probe,
            },
            Migration {
                version: 2,
                name: "doomed",
                up: creates_then_fails,
            },
        ];

        let conn = Connection::open_in_memory().unwrap();
        let err = run_ledger(&conn, &ledger).unwrap_err();
        assert!(matches!(err, AppError::Database(_)));

        assert_eq!(
            user_version(&conn),
            1,
            "the failed migration must not bump user_version past the last good step"
        );
        assert_eq!(
            names_of(&conn, "table"),
            vec!["ledger_probe".to_string()],
            "the failed migration's DDL must roll back, leaving earlier steps intact"
        );
    }

    /// The guard for the drift that existed before the ledger: `initialize()`
    /// created 27 `init_table`s while `create_test_store()` created 23, so tests
    /// ran against a schema production never had. `initialize()` needs a live
    /// `AppHandle`, but after the refactor its entire schema contribution is
    /// `migrations::run` — so driving that directly is the production path.
    #[test]
    fn both_bootstrap_paths_produce_identical_schemas() {
        let production = Connection::open_in_memory().unwrap();
        run(&production).unwrap();

        let test_store = crate::storage::create_test_store();
        let guard = test_store.conn().unwrap();

        assert_eq!(
            schema_fingerprint(&guard),
            schema_fingerprint(&production),
            "create_test_store() and the production bootstrap must build the same schema"
        );
        assert_eq!(user_version(&guard), user_version(&production));
    }
}
