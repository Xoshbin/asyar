pub mod agents;
pub mod clipboard;
pub mod clipboard_fts;
pub mod cloud_sync_e2ee_local;
pub mod cloud_sync_state;
pub mod command_arg_defaults;
pub mod commands;
pub mod extension_cache;
pub mod extension_kv;
pub mod extension_preferences;
pub mod extension_state;
pub mod file_search_pinned;
pub mod file_search_selections;
pub mod mcp_audit;
pub mod mcp_permissions;
pub mod mcp_servers;
pub mod mcp_settings;
pub mod migrations;
pub mod notes;
pub mod notes_fts;
pub mod runs_history;
pub mod script_directories;
pub mod searchbar_accessory;
pub mod shell;
pub mod shortcuts;
pub mod snippets;
pub mod sticky_notes;
pub mod timers;
pub mod walkthrough;

use crate::error::AppError;
use r2d2::{CustomizeConnection, Pool};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use std::path::Path;

const DB_FILE_NAME: &str = "asyar_data.db";

/// How long a writer waits for the write lock before giving up with
/// `SQLITE_BUSY`. Set explicitly rather than left to rusqlite's own 5s
/// default: the longest write in the app is the startup rebuild's
/// `content_hash` backfill, which updates every legacy clipboard row inside
/// one transaction, and on a large history that can outlast five seconds
/// while the rest of the app is already live and writing.
const BUSY_TIMEOUT_MS: i64 = 15_000;

/// Applied to every physical connection the pool opens, before it is ever
/// handed out. `journal_mode` is a property of the database file, but
/// `busy_timeout` is per-connection state and has to be set on each one —
/// which is exactly why it lives here and not in a one-time setup step.
fn connection_pragmas() -> String {
    format!("PRAGMA journal_mode=WAL; PRAGMA busy_timeout={BUSY_TIMEOUT_MS};")
}

/// Cap on simultaneously open connections. SQLite still admits exactly one
/// writer, so extra connections only buy reader concurrency: eight covers the
/// two full-table FTS rebuilds at boot plus ordinary UI and extension traffic,
/// while a launcher that idles most of its life has no use for a web-server-
/// sized pool.
const POOL_SIZE: u32 = 8;

/// Shared SQLite-backed data store for user data (clipboard, snippets, shortcuts).
///
/// Each table supports row-level CRUD — individual inserts, updates, and deletes
/// instead of full-table rewrites.
///
/// Backed by a connection pool, so WAL's concurrent readers are actually
/// concurrent. Two rules come with that:
///
/// * **One connection per transaction.** A transaction lives on the connection
///   that began it; never split one across two [`conn`](Self::conn) calls.
/// * **Never hold a connection across `.await`.** Checked-out connections are
///   a bounded resource; blocking database work belongs in `spawn_blocking`.
#[derive(Clone)]
pub struct DataStore {
    pool: Pool<SqliteConnectionManager>,
    /// Test stores live in a temporary directory (see [`create_test_store`]);
    /// this keeps it alive for as long as any clone of the store.
    #[cfg(test)]
    _tempdir: Option<std::sync::Arc<tempfile::TempDir>>,
}

/// r2d2 hook that stamps [`connection_pragmas`] onto each connection as it is
/// opened, so no connection can reach a caller unconfigured.
#[derive(Debug)]
struct PragmaCustomizer {
    pragmas: String,
}

impl CustomizeConnection<Connection, rusqlite::Error> for PragmaCustomizer {
    fn on_acquire(&self, conn: &mut Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(&self.pragmas)
    }
}

impl DataStore {
    pub fn initialize(app_handle: &tauri::AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        use tauri::Manager;
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("Failed to get app data dir");

        std::fs::create_dir_all(&app_data_dir)?;

        Ok(Self::open_at(&app_data_dir.join(DB_FILE_NAME))?)
    }

    /// Open (or create) the database at `db_path` and return a store serving it.
    fn open_at(db_path: &Path) -> Result<Self, AppError> {
        Self::open_with_pragmas(db_path, connection_pragmas())
    }

    fn open_with_pragmas(db_path: &Path, pragmas: String) -> Result<Self, AppError> {
        let manager = SqliteConnectionManager::file(db_path);
        let pool = Pool::builder()
            .max_size(POOL_SIZE)
            // Open one connection up front and grow on demand — the alternative
            // (r2d2's default `min_idle = max_size`) makes `build` wait for all
            // eight before the app can boot.
            .min_idle(Some(1))
            // A local file handle never goes stale the way a socket does, so
            // recycling connections would be pure churn — and switching both off
            // means r2d2 skips its reaper thread entirely.
            .max_lifetime(None)
            .idle_timeout(None)
            .connection_customizer(Box::new(PragmaCustomizer { pragmas }))
            .build(manager)
            .map_err(|e| AppError::Database(format!("failed to build the SQLite pool: {e}")))?;

        // Migrate on a single connection while the pool is still private to this
        // function: nothing else can hold a handle to it yet, so two connections
        // cannot race to apply the ledger.
        {
            let conn = pool.get().map_err(|e| {
                AppError::Database(format!("failed to open the migration connection: {e}"))
            })?;
            migrations::run(&conn)?;
        }

        Ok(Self {
            pool,
            #[cfg(test)]
            _tempdir: None,
        })
    }

    /// Check out a connection from the pool. Callers get a handle that derefs
    /// to [`Connection`]; drop it as soon as the work is done.
    pub fn conn(&self) -> Result<r2d2::PooledConnection<SqliteConnectionManager>, AppError> {
        self.pool
            .get()
            .map_err(|e| AppError::Database(format!("no SQLite connection available: {e}")))
    }
}

#[cfg(test)]
mod agents_test;

/// A throwaway store backed by a real file in a temporary directory.
///
/// A file, not `:memory:`, on purpose: each connection to `:memory:` is its own
/// separate empty database, so a pooled in-memory store would hand out
/// connections that cannot see each other's schema or rows.
#[cfg(test)]
pub fn create_test_store() -> DataStore {
    create_test_store_with_pragmas(connection_pragmas())
}

/// As [`create_test_store`], with foreign-key enforcement switched on.
///
/// Production deliberately leaves `foreign_keys` at SQLite's OFF default; a few
/// agent tests predate the pool and assert cascade behaviour, so they get it
/// explicitly rather than having it turned on globally.
#[cfg(test)]
pub fn create_test_store_with_foreign_keys() -> DataStore {
    create_test_store_with_pragmas(format!("{} PRAGMA foreign_keys=ON;", connection_pragmas()))
}

#[cfg(test)]
fn create_test_store_with_pragmas(pragmas: String) -> DataStore {
    let dir = tempfile::tempdir().expect("temp dir for the test store");
    let mut store = DataStore::open_with_pragmas(&dir.path().join(DB_FILE_NAME), pragmas)
        .expect("test store must open");
    store._tempdir = Some(std::sync::Arc::new(dir));
    store
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::time::Duration;

    /// Run `f` on a worker thread and fail the test if it has not finished in
    /// ten seconds. Every concurrency test below needs this: the failure mode
    /// under a single shared connection is *blocking forever*, not returning a
    /// wrong answer, and a hung `cargo test` is not a test result.
    fn run_with_timeout<T: Send + 'static>(
        label: &str,
        f: impl FnOnce() -> T + Send + 'static,
    ) -> T {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(f());
        });
        match rx.recv_timeout(Duration::from_secs(10)) {
            Ok(value) => value,
            Err(RecvTimeoutError::Timeout) => panic!(
                "{label}: still blocked after 10s — a second connection cannot be \
                 obtained while the first is alive"
            ),
            Err(RecvTimeoutError::Disconnected) => {
                panic!("{label}: worker thread panicked (see the panic printed above)")
            }
        }
    }

    fn insert_snippet(conn: &Connection, id: &str, name: &str) {
        conn.execute(
            "INSERT INTO snippets (id, keyword, expansion, name, created_at, pinned)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            rusqlite::params![id, ":probe", "ciphertext", name, 1.0_f64],
        )
        .expect("insert snippet");
    }

    /// The whole point of the change: WAL exists so readers run concurrently,
    /// and a single global mutex made that impossible. Two connections must be
    /// checked out at the same time and both be usable.
    #[test]
    fn two_connections_are_usable_at_the_same_time() {
        let store = create_test_store();

        run_with_timeout("two simultaneous connections", move || {
            let first = store.conn().expect("first connection");
            let second = store
                .conn()
                .expect("second connection while first is alive");

            first
                .execute_batch("CREATE TABLE pool_probe (id INTEGER);")
                .expect("write on the first connection");
            let seen: i64 = second
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = 'pool_probe'",
                    [],
                    |r| r.get(0),
                )
                .expect("read on the second connection");

            assert_eq!(seen, 1, "both connections must address the same database");
        });
    }

    /// Guard against backing the store with `:memory:`: every connection to
    /// `:memory:` is its own empty database, so a pooled store built that way
    /// would hand the reader a schema-less connection and this read would fail
    /// with "no such table: snippets".
    #[test]
    fn a_row_written_on_one_connection_is_visible_on_another() {
        let store = create_test_store();

        run_with_timeout("write on one connection, read on another", move || {
            let writer = store.conn().expect("writer connection");
            insert_snippet(&writer, "pool-probe", "Probe");

            // Deliberately still holding `writer` — the reader must not have to
            // wait for it to be released.
            let reader = store.conn().expect("reader connection");
            let name: String = reader
                .query_row(
                    "SELECT name FROM snippets WHERE id = 'pool-probe'",
                    [],
                    |r| r.get(0),
                )
                .expect("committed row must be visible on a second connection");

            assert_eq!(name, "Probe");
        });
    }

    /// SQLite allows one writer at a time. Once writers sit on separate
    /// connections they collide inside SQLite instead of queueing on a Rust
    /// mutex, and the loser gets `SQLITE_BUSY` immediately unless a busy
    /// timeout is configured on every connection.
    ///
    /// Made deterministic rather than racy: the holder takes the write lock
    /// with `BEGIN IMMEDIATE`, the contender starts its insert only after that,
    /// and the holder commits well inside the busy timeout.
    #[test]
    fn a_writer_waits_out_a_held_write_lock_instead_of_failing_busy() {
        let store = create_test_store();
        let contender_store = store.clone();

        run_with_timeout("two concurrent writers", move || {
            let holder = store.conn().expect("holder connection");
            holder
                .execute_batch("BEGIN IMMEDIATE")
                .expect("take the write lock");
            insert_snippet(&holder, "held", "Held");

            let (lock_taken_tx, lock_taken_rx) = mpsc::channel::<()>();
            let contender = std::thread::spawn(move || {
                lock_taken_rx.recv().expect("holder signalled");
                let conn = contender_store.conn().expect("contender connection");
                conn.execute(
                    "INSERT INTO snippets (id, keyword, expansion, name, created_at, pinned)
                     VALUES ('contended', ':probe', 'ciphertext', 'Contended', 2.0, 0)",
                    [],
                )
            });

            lock_taken_tx.send(()).expect("signal the contender");
            std::thread::sleep(Duration::from_millis(250));
            holder
                .execute_batch("COMMIT")
                .expect("release the write lock");

            let result = contender.join().expect("contender thread");
            assert!(
                result.is_ok(),
                "the second writer must wait for the lock, not fail: {:?}",
                result.unwrap_err()
            );

            let ids: Vec<String> = {
                let mut stmt = holder
                    .prepare("SELECT id FROM snippets ORDER BY id")
                    .unwrap();
                let rows = stmt.query_map([], |r| r.get(0)).unwrap();
                rows.map(Result::unwrap).collect()
            };
            assert_eq!(ids, vec!["contended".to_string(), "held".to_string()]);
        });
    }

    /// The ledger runs once per store, on one connection, before the pool
    /// serves anybody — and a second store opened against the same file finds
    /// nothing left to do and touches no existing row.
    #[test]
    fn opening_the_same_file_twice_migrates_once_and_keeps_rows() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join(DB_FILE_NAME);
        let latest = migrations::MIGRATIONS.last().unwrap().version;

        let first = DataStore::open_at(&db_path).expect("first open");
        {
            let conn = first.conn().unwrap();
            insert_snippet(&conn, "survivor", "Survivor");
            assert_eq!(user_version(&conn), latest);
        }
        drop(first);

        let second = DataStore::open_at(&db_path).expect("second open");
        let conn = second.conn().unwrap();

        assert_eq!(
            user_version(&conn),
            latest,
            "a second open must leave user_version at the newest ledger entry"
        );
        let name: String = conn
            .query_row("SELECT name FROM snippets WHERE id = 'survivor'", [], |r| {
                r.get(0)
            })
            .expect("rows written before the second open must still be there");
        assert_eq!(name, "Survivor");
    }

    /// Every connection the pool can hand out must carry our busy timeout —
    /// all of them, checked out at once, not just the first one.
    ///
    /// Asserted explicitly because rusqlite happens to apply a 5s default of
    /// its own: without this test the app would be silently relying on an
    /// upstream default it never chose and would not notice if it changed.
    #[test]
    fn every_pooled_connection_carries_the_configured_busy_timeout() {
        let store = create_test_store();

        run_with_timeout("busy timeout on every connection", move || {
            let conns: Vec<_> = (0..POOL_SIZE)
                .map(|_| store.conn().expect("connection"))
                .collect();

            for (i, conn) in conns.iter().enumerate() {
                let timeout: i64 = conn
                    .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
                    .unwrap();
                assert_eq!(
                    timeout, BUSY_TIMEOUT_MS,
                    "connection {i} was handed out without the configured busy timeout"
                );
            }
        });
    }

    fn user_version(conn: &Connection) -> u32 {
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap() as u32
    }

    /// Clones share one pool — a `DataStore` handed to a subsystem must reach
    /// the same database as the one the rest of the app holds.
    #[test]
    fn clones_of_a_store_share_one_database() {
        let store = create_test_store();
        let clone = store.clone();

        insert_snippet(&store.conn().unwrap(), "shared", "Shared");

        let name: String = clone
            .conn()
            .unwrap()
            .query_row("SELECT name FROM snippets WHERE id = 'shared'", [], |r| {
                r.get(0)
            })
            .expect("a clone must see rows written through the original");
        assert_eq!(name, "Shared");
    }
}
