pub mod clipboard;
pub mod commands;
pub mod extension_cache;
pub mod extension_kv;
pub mod extension_preferences;
pub mod shell;
pub mod shortcuts;
pub mod snippets;

use crate::error::AppError;
use rusqlite::Connection;
use std::sync::Mutex;

const DB_FILE_NAME: &str = "asyar_data.db";

/// Shared SQLite-backed data store for user data (clipboard, snippets, shortcuts).
///
/// Each table supports row-level CRUD — individual inserts, updates, and deletes
/// instead of full-table rewrites.
pub struct DataStore {
    db: Mutex<Connection>,
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
        shell::init_table(&conn)?;
        crate::oauth::token_store::init_table(&conn)?;

        Ok(Self {
            db: Mutex::new(conn),
        })
    }

    pub fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, AppError> {
        self.db.lock().map_err(|_| AppError::Lock)
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
    shell::init_table(&conn).unwrap();
    crate::oauth::token_store::init_table(&conn).unwrap();
    DataStore {
        db: Mutex::new(conn),
    }
}
