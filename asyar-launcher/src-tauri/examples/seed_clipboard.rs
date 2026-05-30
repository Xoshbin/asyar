//! Stress-test seed: bulk-insert N synthetic rows into the real launcher
//! clipboard DB so you can open the launcher and see how 30k items feels.
//!
//! Run with:
//!   1. Quit Asyar first (SQLite WAL locks conflict otherwise).
//!   2. cargo run --example seed_clipboard --release -- 30000
//!
//! Optional second arg: a path to the SQLite db (defaults to the
//! platform's Asyar data file).
//!
//! Skips `cleanup` and FTS upsert during seeding for speed. The next
//! launcher start rebuilds the FTS index from the seeded rows (~300-900ms
//! background task) and ages-cleanup runs naturally from then on.

use asyar_lib::crypto::keystore::{KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE};
use asyar_lib::storage::clipboard::{add_item, init_table, ClipboardItem};
use asyar_lib::storage::cloud_sync_state;
use keyring::Entry;
use rusqlite::Connection;
use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

fn default_db_path() -> PathBuf {
    if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").expect("HOME not set");
        PathBuf::from(home).join("Library/Application Support/org.asyar.app/asyar_data.db")
    } else if cfg!(target_os = "linux") {
        let home = std::env::var("HOME").expect("HOME not set");
        PathBuf::from(home).join(".local/share/org.asyar.app/asyar_data.db")
    } else if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA").expect("APPDATA not set");
        PathBuf::from(appdata).join("org.asyar.app/asyar_data.db")
    } else {
        panic!("unsupported platform");
    }
}

fn load_master_key() -> [u8; 32] {
    let entry =
        Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).expect("keychain entry construction");
    let value = entry
        .get_password()
        .expect("master key not found in OS keychain — launch Asyar at least once to generate one");
    // The keystore stores the 32-byte key as base64. Match the launcher's load_or_create logic:
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value.as_bytes())
        .expect("master key is not base64 — keychain entry corrupted?");
    assert_eq!(
        bytes.len(),
        32,
        "master key must be 32 bytes, got {}",
        bytes.len()
    );
    let mut k = [0u8; 32];
    k.copy_from_slice(&bytes);
    k
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64
}

// A handful of templates so search has variety to chew on.
const TEMPLATES: &[&str] = &[
    "https://example.com/article/{n}",
    "let result = process_batch({n});",
    "Meeting notes for sprint {n}: review tasks, plan retro.",
    "TODO: refactor module {n} before next release.",
    "Order #{n} shipped today — tracking 1Z999AA10123456784.",
    "function calculate({n}) {{ return n * 2; }}",
    "Reminder: review PR #{n} — security fix.",
    "{n}@asyar.org",
    "The quick brown fox jumps over {n} lazy dogs.",
    "API response code: 200 OK, payload size {n} bytes.",
    "git checkout -b feature/{n}-improvements",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit {n}.",
];

fn make_item(i: u32, base_time: f64) -> ClipboardItem {
    let template = TEMPLATES[(i as usize) % TEMPLATES.len()];
    let body = template.replace("{n}", &i.to_string());
    let preview: String = body.chars().take(100).collect();
    ClipboardItem {
        id: format!("seed-{i}"),
        item_type: "text".to_string(),
        content: Some(body),
        preview: Some(preview),
        // Newest items first — spread across the last 30 days.
        created_at: base_time - (i as f64) * 60_000.0,
        favorite: i.is_multiple_of(1000), // ~0.1% favorited
        metadata: None,
        source_app: Some(serde_json::json!({
            "name": "Seed Tool",
            "bundleId": "dev.seed.clipboard",
        })),
        redacted_kinds: None,
    }
}

fn main() {
    let n: u32 = std::env::args()
        .nth(1)
        .expect("usage: seed_clipboard <N> [db_path]")
        .parse()
        .expect("N must be a positive integer");

    let db_path: PathBuf = std::env::args()
        .nth(2)
        .map(PathBuf::from)
        .unwrap_or_else(default_db_path);

    if !db_path.exists() {
        panic!(
            "DB not found at {} — launch Asyar at least once to create it",
            db_path.display()
        );
    }
    eprintln!("DB: {}", db_path.display());

    eprintln!("Reading master key from OS keychain ({KEYCHAIN_SERVICE}/{KEYCHAIN_ACCOUNT})…");
    let key = load_master_key();

    let conn = Connection::open(&db_path).expect("open SQLite");
    init_table(&conn).expect("init clipboard table");
    cloud_sync_state::init_table(&conn).expect("init cloud-sync journal");

    let base = now_ms();
    let t = Instant::now();
    let tx = conn.unchecked_transaction().expect("begin tx");
    for i in 0..n {
        add_item(&tx, &make_item(i, base), &key).expect("add_item");
        if i % 5000 == 0 && i > 0 {
            eprintln!("  …seeded {i}");
        }
    }
    tx.commit().expect("commit");
    eprintln!("Done: {n} rows in {:.1}s.", t.elapsed().as_secs_f64());
    eprintln!("Next launcher start will rebuild the FTS index automatically (~1s background).");
}
