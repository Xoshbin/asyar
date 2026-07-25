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
