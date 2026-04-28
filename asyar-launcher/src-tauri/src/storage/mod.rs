pub mod clipboard;
pub mod command_arg_defaults;
pub mod commands;
pub mod extension_cache;
pub mod extension_kv;
pub mod extension_preferences;
pub mod extension_state;
pub mod searchbar_accessory;
pub mod shell;
pub mod shortcuts;
pub mod snippets;
pub mod timers;

use crate::error::AppError;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

const DB_FILE_NAME: &str = "asyar_data.db";

/// Shared SQLite-backed data store for user data (clipboard, snippets, shortcuts).
///
/// Each table supports row-level CRUD — individual inserts, updates, and deletes
/// instead of full-table rewrites.
pub struct DataStore {
    db: Arc<Mutex<Connection>>,
}

impl DataStore {
    pub fn initialize(
        app_handle: &tauri::AppHandle,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        use tauri::Manager;
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("Failed to get app data dir");

        std::fs::create_dir_all(&app_data_dir)?;

        let db_path = app_data_dir.join(DB_FILE_NAME);
        let conn = Connection::open(&db_path)?;

        // WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        // Create all tables
        clipboard::init_table(&conn)?;
        snippets::init_table(&conn)?;
        shortcuts::init_table(&conn)?;
        extension_kv::init_table(&conn)?;
        extension_preferences::init_table(&conn)?;
        extension_cache::init_table(&conn)?;
        extension_state::init_table(&conn)?;
        shell::init_table(&conn)?;
        timers::init_table(&conn)?;
        command_arg_defaults::init_table(&conn)?;
        searchbar_accessory::init_table(&conn)?;
        crate::aliases::init_table(&conn)?;
        crate::oauth::token_store::init_table(&conn)?;

        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, AppError> {
        self.db.lock().map_err(|_| AppError::Lock)
    }

    /// Return a clone of the `Arc` guarding the underlying SQLite `Connection`.
    /// Used by subsystems (like the timer scheduler) that need a cloneable
    /// handle they can move into a spawned tokio task while still sharing the
    /// same physical connection as the rest of the DataStore-backed features.
    pub fn conn_arc(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.db)
    }
}

#[cfg(test)]
pub fn create_test_store() -> DataStore {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory DB");
    conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
    clipboard::init_table(&conn).unwrap();
    snippets::init_table(&conn).unwrap();
    shortcuts::init_table(&conn).unwrap();
    extension_kv::init_table(&conn).unwrap();
    extension_preferences::init_table(&conn).unwrap();
    extension_state::init_table(&conn).unwrap();
    shell::init_table(&conn).unwrap();
    timers::init_table(&conn).unwrap();
    command_arg_defaults::init_table(&conn).unwrap();
    searchbar_accessory::init_table(&conn).unwrap();
    crate::aliases::init_table(&conn).unwrap();
    crate::oauth::token_store::init_table(&conn).unwrap();
    DataStore {
        db: std::sync::Arc::new(Mutex::new(conn)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conn_arc_shares_underlying_data_with_conn() {
        let store = create_test_store();
        {
            let arc = store.conn_arc();
            let guard = arc.lock().unwrap();
            guard
                .execute_batch("CREATE TABLE timer_arc_probe (id INTEGER);")
                .unwrap();
        }
        let conn = store.conn().unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='timer_arc_probe'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn conn_arc_hands_out_handles_to_same_mutex() {
        let store = create_test_store();
        let a = store.conn_arc();
        let b = store.conn_arc();
        assert!(std::sync::Arc::ptr_eq(&a, &b));
    }
}
