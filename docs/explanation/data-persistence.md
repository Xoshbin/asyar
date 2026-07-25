---
order: 12
---

# Data Persistence & Known Limitations

## 13. Data Persistence Architecture

Asyar uses two SQLite databases managed by the Rust backend:

| Database          | Module                 | Tables                                                          | Purpose                                                    |
| ----------------- | ---------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| `search_index.db` | `search_engine/mod.rs` | `search_items`                                                  | Application and command search index with frecency scoring |
| `asyar_data.db`   | `storage/mod.rs`       | `clipboard_items`, `snippets`, `shortcuts`, `extension_storage` | User data persistence with row-level CRUD                  |

Both databases use WAL mode for concurrent read performance and are stored in the platform-specific app data directory.

### The `asyar_data.db` connection pool

`DataStore` owns an [r2d2](https://docs.rs/r2d2) pool of SQLite connections rather than one shared connection. `store.conn()` checks one out; the handle derefs to `rusqlite::Connection`, so every `storage::*` function keeps taking a plain `&Connection`.

This exists because WAL only pays off if readers can actually run at the same time. With a single `Mutex<Connection>`, every reader queued behind every other caller, and the worst case was cold start: the clipboard and notes FTS rebuilds each scan and decrypt the full table, and while they did, no other database work in the app could proceed.

Three rules come with the pool:

- **One connection per transaction.** A transaction lives on the connection that began it. Never start one on a connection from one `conn()` call and finish it on another — hold a single handle for the whole transaction.
- **A busy timeout is mandatory, and is set on every connection.** SQLite still admits exactly one writer. Writers now collide inside SQLite instead of queueing on a Rust mutex, and the loser fails immediately with `SQLITE_BUSY` unless a timeout tells it to wait. `BUSY_TIMEOUT_MS` (15s) is applied by an r2d2 connection customizer as each connection is opened, so no connection can reach a caller unconfigured. The value is set explicitly rather than left to rusqlite's own 5s default — the longest write in the app is the startup rebuild's `content_hash` backfill, one transaction covering every legacy clipboard row.
- **Never hold a connection across `.await`.** Checked-out connections are a bounded resource (`POOL_SIZE`, 8), so a handle parked on an await point is one the rest of the app cannot use. Blocking database work belongs in `spawn_blocking`, as the two FTS rebuild tasks do. The old `MutexGuard` was `!Send` and the compiler enforced this for you; a pooled connection is `Send`, so it is now a rule you have to follow rather than one you cannot break.

The pool is 8 connections: SQLite serialises writers regardless, so extra connections only buy reader concurrency, and a launcher that idles most of its life has no use for a web-server-sized pool. Migrations run on a single connection while the pool is still private to `open_at`, so two connections can never race to apply the ledger.

Test stores (`create_test_store()`) are backed by a real file in a temporary directory, not `:memory:` — each connection to `:memory:` is its own separate empty database, so a pooled in-memory store would hand out connections that cannot see each other's schema or rows.

**`asyar_data.db` tables:**

- **`clipboard_items`** — Clipboard history (up to 1000 items). Each copy/paste is a single `INSERT`, not a full-table rewrite. Indexed on `created_at DESC` and `favorite`.
- **`snippets`** — Text expansion snippets. Row-level upsert/update/delete.
- **`shortcuts`** — Item keyboard shortcuts. Row-level upsert with `object_id` uniqueness.
- **`extension_storage`** — Scoped key-value store for Tier 2 extensions. Composite primary key `(extension_id, key)` ensures data isolation. Cleaned up automatically on extension uninstall.

**Settings, portals, and AI chat** continue to use Tauri plugin-store (JSON files) — their datasets are small and write-infrequent.

### Schema migrations

`asyar_data.db` has one ordered, append-only ledger in `storage/migrations.rs`, keyed on `PRAGMA user_version`. `migrations::run()` applies every entry above the database's stamped version, each in its own transaction, and is the only thing that builds the schema — both `DataStore::initialize` and `create_test_store()` call it, so the two can never drift apart.

**To add a migration, in four lines:**

1. Append one `Migration` to `MIGRATIONS` with the next version number (they start at 1 and must stay gapless — a test enforces this).
2. Write its `up` as plain forward-only SQL. No `PRAGMA table_info` sniffing: the version already tells you what the database contains.
3. Never edit, reorder, or renumber a published entry — installs in the field are already stamped with it and will not replay it.
4. Run `cargo test storage::migrations`; the fresh-DB test's table list is the schema snapshot you update alongside a new table.

Version 1 is the `baseline`: it calls the pre-ledger `init_table` functions, which are idempotent, so an existing populated database is recognised and stamped rather than rebuilt. The per-module column sniffing still living inside those functions is scheduled for removal, not part of the ledger contract.

---

## 14. Known Limitations & Future Work

1. **Checksum Verification:** The publish pipeline computes SHA-256 checksums for extension ZIPs and stores them in the Asyar Store. The app verifies checksums on download. Cryptographic signature verification (code signing) is not yet implemented — the system relies on HTTPS transport + checksum integrity.
2. **Symlink Support for Dev Tools:** The `asyar link` CLI command creates symlinks from the app data extensions directory to the developer's project. The Rust custom protocol handler resolves symlinks correctly on macOS and Linux. Windows support uses a copy fallback (`asyar link --copy`).
3. **`unsafe-eval` Application Policy:** The iframe Content-Security-Policy currently permits `'unsafe-eval'`. While the Tier 2 execution limits blast radius significantly, this remains a surface area vulnerability for advanced XSS should an extension load untrusted network content internally. Future iterations should aim to disable this entirely for Store-certified extensions once dev workflows standardize on strict pre-evaluation.
