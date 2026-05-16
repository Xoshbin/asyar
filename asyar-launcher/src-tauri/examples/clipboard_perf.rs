//! Throwaway perf runner — not part of the test suite.
//!
//! Run with:
//!   cargo run --example clipboard_perf --release -- 10000
//!   cargo run --example clipboard_perf --release -- 50000

use asyar_lib::storage::clipboard::{
    init_table, list_initial, list_older, record_capture_with_fts, search, ClipboardItem,
};
use asyar_lib::storage::clipboard_fts::{mark_ready, rebuild_from_disk, ClipboardFts};
use rusqlite::Connection;
use std::time::Instant;

fn key() -> [u8; 32] {
    [0xAB; 32]
}

fn now_ms() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}

fn make_text_item(i: u32, base_ms: f64) -> ClipboardItem {
    // Spread items across the past 30 days so none fall outside the 90-day
    // age-cleanup window. Items are ordered newest-first (highest created_at
    // for i=0) so list_initial returns the most-recent window.
    let spread_ms = 30.0 * 24.0 * 60.0 * 60.0 * 1000.0; // 30 days in ms
    ClipboardItem {
        id: format!("perf-{i}"),
        item_type: "text".into(),
        content: Some(format!(
            "perf body number {i} the quick brown fox jumps over the lazy dog"
        )),
        preview: Some(format!("perf body number {i}")),
        // i=0 → base_ms (now), i=N-1 → base_ms - spread_ms
        created_at: base_ms - (i as f64 / 10000.0) * spread_ms,
        favorite: false,
        metadata: None,
        source_app: None,
        redacted_kinds: None,
    }
}

fn main() {
    let n: u32 = std::env::args()
        .nth(1)
        .expect("usage: clipboard_perf <N>")
        .parse()
        .unwrap();

    let conn = Connection::open_in_memory().unwrap();
    init_table(&conn).unwrap();
    asyar_lib::storage::cloud_sync_state::init_table(&conn).unwrap();
    let fts = ClipboardFts::new_in_memory().unwrap();
    let key = key();
    let base_ms = now_ms();

    // Seed.
    let t = Instant::now();
    for i in 0..n {
        record_capture_with_fts(&conn, &make_text_item(i, base_ms), None, &key, &fts).unwrap();
    }
    eprintln!("seed {n} rows: {:.0} ms", t.elapsed().as_millis());

    // Rebuild (cold-start simulation).
    let fts2 = ClipboardFts::new_in_memory().unwrap();
    let t = Instant::now();
    rebuild_from_disk(&conn, &fts2, &key).unwrap();
    mark_ready();
    eprintln!("rebuild {n} rows: {:.0} ms", t.elapsed().as_millis());

    // list_initial.
    let t = Instant::now();
    let page = list_initial(&conn, 100, &key).unwrap();
    eprintln!(
        "list_initial(100) of {n}: {:.2} ms ({} rows)",
        t.elapsed().as_secs_f64() * 1000.0,
        page.recent.len()
    );

    // list_older one page.
    if let Some(cursor) = page.next_cursor {
        let t = Instant::now();
        let older = list_older(&conn, &cursor, 200, &key).unwrap();
        eprintln!(
            "list_older(200) of {n}: {:.2} ms ({} rows)",
            t.elapsed().as_secs_f64() * 1000.0,
            older.items.len()
        );
    } else {
        eprintln!("list_older(200) of {n}: SKIPPED (no more rows)");
    }

    // search.
    let t = Instant::now();
    let res = search(&conn, &fts2, "perf", 200, &key).unwrap();
    eprintln!(
        "search('perf') of {n}: {:.2} ms ({} hits, state={})",
        t.elapsed().as_secs_f64() * 1000.0,
        res.items.len(),
        res.index_state
    );
}
