//! Pure-function decision logic for per-item delta cloud sync.
//!
//! The orchestrator owns no I/O. Each function takes a snapshot of the
//! relevant state (local provider sources, journal rows, server pages) and
//! returns a `Vec` of [`UploadDecision`]s or a [`MergeReport`]. The Tauri
//! command layer wraps these decisions with HTTP + journal writes.
//!
//! Pure functions keep the decision logic exhaustively testable: every test
//! is a deterministic input → output mapping with no fixtures, no fake DB,
//! no fake HTTP.
//!
//! Spec: `docs/superpowers/specs/2026-05-04-per-category-cloud-sync.md`
//! (revised to per-item delta sync, 2026-05-04).

use crate::storage::cloud_sync_state::{CursorState, ItemJournalEntry};
use crate::sync::types::{
    DownloadDecision, ItemPullPage, ItemPushItem, LocalItemSource, MergeReport, SyncStatus,
    UploadDecision,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Per-item maximum payload (256 KB). Payloads above this are dropped via
/// [`UploadDecision::DropOversize`] and surface a diagnostic. The user's
/// launcher keeps the item locally; the cloud copy is whatever was last
/// successfully uploaded.
pub const MAX_ITEM_PAYLOAD_BYTES: usize = 256 * 1024;

/// Per-batch maximum item count (500). The orchestrator chunks
/// `Vec<UploadDecision>` into batches of at most this size for the
/// `api_client` to send.
pub const MAX_BATCH_ITEM_COUNT: usize = 500;

/// SHA-256 the plaintext, return both raw 32 bytes and lowercase hex.
///
/// Single-pass, no allocations beyond the hex string.
pub fn compute_content_hash(plaintext: &[u8]) -> ([u8; 32], String) {
    let mut hasher = Sha256::new();
    hasher.update(plaintext);
    let digest = hasher.finalize();
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&digest);
    let hex = bytes_to_hex(&bytes);
    (bytes, hex)
}

/// Decide which items need uploading.
///
/// `local_sources` is the launcher's current state — one entry per item the
/// providers know about, including local deletes flagged via `is_tombstone`.
/// `journal` is the journal rows from
/// [`crate::storage::cloud_sync_state::get_dirty`].
///
/// Returns one decision per `local_sources` entry, in input order:
/// - `is_tombstone = true` → [`UploadDecision::PushTombstone`].
/// - payload > [`MAX_ITEM_PAYLOAD_BYTES`] → [`UploadDecision::DropOversize`].
/// - hash matches journal's `last_uploaded_hash` and not a tombstone →
///   [`UploadDecision::Skip`] (defensive — `is_dirty` should not be set
///   without a real change, but we catch it here cheaply).
/// - otherwise → [`UploadDecision::PushItem`].
///
/// Tombstones found in the journal but absent from `local_sources` (the
/// provider has forgotten about them locally but the journal still owes
/// the server a delete) are appended at the end as `PushTombstone`
/// decisions.
pub fn decide_uploads(
    local_sources: &[LocalItemSource],
    journal: &[ItemJournalEntry],
) -> Vec<UploadDecision> {
    let journal_map: HashMap<&str, &ItemJournalEntry> =
        journal.iter().map(|j| (j.item_id.as_str(), j)).collect();

    let mut decisions: Vec<UploadDecision> = Vec::with_capacity(local_sources.len());
    let mut seen_ids: std::collections::HashSet<&str> =
        std::collections::HashSet::with_capacity(local_sources.len());

    for src in local_sources {
        seen_ids.insert(src.item_id.as_str());

        if src.is_tombstone {
            decisions.push(UploadDecision::PushTombstone {
                item_id: src.item_id.clone(),
                category_id: src.category_id.clone(),
            });
            continue;
        }

        let size_bytes = src.content.as_bytes().len();
        if size_bytes > MAX_ITEM_PAYLOAD_BYTES {
            decisions.push(UploadDecision::DropOversize {
                item_id: src.item_id.clone(),
                category_id: src.category_id.clone(),
                size_bytes,
            });
            continue;
        }

        let (hash_bytes, _) = compute_content_hash(src.content.as_bytes());
        let last_hash = journal_map
            .get(src.item_id.as_str())
            .and_then(|j| j.last_uploaded_hash.as_deref());

        if let Some(prev) = last_hash {
            if prev == hash_bytes.as_slice() {
                decisions.push(UploadDecision::Skip {
                    item_id: src.item_id.clone(),
                });
                continue;
            }
        }

        decisions.push(UploadDecision::PushItem {
            item_id: src.item_id.clone(),
            category_id: src.category_id.clone(),
            plaintext: src.content.clone(),
            content_hash: hash_bytes,
        });
    }

    // Pick up tombstones from the journal that the providers have already
    // forgotten about — we still owe the server a delete for them.
    for entry in journal {
        if entry.is_tombstone && !seen_ids.contains(entry.item_id.as_str()) {
            decisions.push(UploadDecision::PushTombstone {
                item_id: entry.item_id.clone(),
                category_id: entry.category_id.clone(),
            });
        }
    }

    decisions
}

/// Chunk decisions into batches of at most [`MAX_BATCH_ITEM_COUNT`].
///
/// Each batch contains only the upload-emitting variants
/// ([`UploadDecision::PushItem`], [`UploadDecision::PushTombstone`]).
/// [`UploadDecision::Skip`] and [`UploadDecision::DropOversize`] decisions are
/// dropped during chunking — they have no wire effect but are returned by
/// [`decide_uploads`] for diagnostic inspection.
///
/// The chunker output is what the api_client serializes into
/// [`crate::sync::types::ItemPushBatchRequest`] payloads.
pub fn chunk_for_upload(decisions: Vec<UploadDecision>) -> Vec<Vec<ItemPushItem>> {
    let push_items: Vec<ItemPushItem> = decisions
        .into_iter()
        .filter_map(|d| match d {
            UploadDecision::PushItem {
                item_id,
                category_id,
                plaintext,
                content_hash,
            } => Some(ItemPushItem {
                id: item_id,
                category_id,
                content_hash_hex: Some(bytes_to_hex(&content_hash)),
                payload: Some(plaintext),
                deleted: None,
            }),
            UploadDecision::PushTombstone {
                item_id,
                category_id,
            } => Some(ItemPushItem {
                id: item_id,
                category_id,
                content_hash_hex: None,
                payload: None,
                deleted: Some(true),
            }),
            UploadDecision::Skip { .. } | UploadDecision::DropOversize { .. } => None,
        })
        .collect();

    if push_items.is_empty() {
        return Vec::new();
    }

    push_items
        .chunks(MAX_BATCH_ITEM_COUNT)
        .map(|c| c.to_vec())
        .collect()
}

/// Decide what to do with a server pull page.
///
/// `journal_lookup` is a closure mapping `item_id → Option<ItemJournalEntry>`
/// — implemented by the command layer as a journal-table lookup; the
/// orchestrator stays pure.
///
/// For each server item, in input order:
/// - server tombstone (`deleted = true`) → [`DownloadDecision::ApplyDelete`]
///   (skipped if the journal already has a matching tombstone at the same
///   or higher version).
/// - server hash matches journal hash AND server version <= journal version
///   → [`DownloadDecision::Skip`].
/// - server version > journal version → [`DownloadDecision::ApplyUpsert`]
///   (with LWW warning if the local journal entry was dirty).
/// - server version == journal version, hash differs →
///   [`DownloadDecision::ApplyUpsert`] (defensive — server is truth).
/// - server version < journal version (impossible given monotonic server
///   versions, but defensive) → [`DownloadDecision::Skip`].
///
/// LWW warnings are emitted for any item that was locally dirty but the
/// server already has a newer version. The returned
/// [`MergeReport::lww_warnings`] contains those item ids.
pub fn merge_pull<F>(server_page: &ItemPullPage, journal_lookup: F) -> MergeReport
where
    F: Fn(&str) -> Option<ItemJournalEntry>,
{
    let mut report = MergeReport::default();

    for record in &server_page.items {
        let journal = journal_lookup(record.id.as_str());

        if record.deleted {
            // Tombstone path — emit ApplyDelete unless the journal already
            // has a tombstone at the same or higher version.
            let already_synced = journal
                .as_ref()
                .map(|j| j.is_tombstone && j.server_version.unwrap_or(i64::MIN) >= record.version)
                .unwrap_or(false);
            if already_synced {
                report.actions.push(DownloadDecision::Skip {
                    item_id: record.id.clone(),
                });
                continue;
            }

            if journal.as_ref().map(|j| j.is_dirty).unwrap_or(false) {
                report.lww_warnings.push(record.id.clone());
            }

            report.actions.push(DownloadDecision::ApplyDelete {
                item_id: record.id.clone(),
                category_id: record.category_id.clone(),
                server_version: record.version,
            });
            continue;
        }

        // Live path — needs a hash + payload to be applied.
        let server_hash = match record.content_hash_hex.as_deref().and_then(parse_hex_hash) {
            Some(h) => h,
            None => {
                // Server gave us a live row without a hash — defensive skip;
                // we cannot record it on the journal without a hash.
                report.actions.push(DownloadDecision::Skip {
                    item_id: record.id.clone(),
                });
                continue;
            }
        };
        let payload = match record.payload.clone() {
            Some(p) => p,
            None => {
                // Live row without a payload — defensive skip.
                report.actions.push(DownloadDecision::Skip {
                    item_id: record.id.clone(),
                });
                continue;
            }
        };

        match journal.as_ref() {
            None => {
                // Brand new item we've never seen → ApplyUpsert.
                report.actions.push(DownloadDecision::ApplyUpsert {
                    item_id: record.id.clone(),
                    category_id: record.category_id.clone(),
                    plaintext: payload,
                    server_hash,
                    server_version: record.version,
                });
            }
            Some(j) => {
                let local_version = j.server_version.unwrap_or(i64::MIN);
                let hash_matches = j
                    .last_uploaded_hash
                    .as_deref()
                    .map(|h| h == server_hash.as_slice())
                    .unwrap_or(false);

                if record.version < local_version {
                    // Server going backwards is impossible given monotonic
                    // server versions, but handle it defensively.
                    report.actions.push(DownloadDecision::Skip {
                        item_id: record.id.clone(),
                    });
                    continue;
                }

                if record.version == local_version && hash_matches {
                    report.actions.push(DownloadDecision::Skip {
                        item_id: record.id.clone(),
                    });
                    continue;
                }

                if record.version > local_version && j.is_dirty {
                    report.lww_warnings.push(record.id.clone());
                }

                report.actions.push(DownloadDecision::ApplyUpsert {
                    item_id: record.id.clone(),
                    category_id: record.category_id.clone(),
                    plaintext: payload,
                    server_hash,
                    server_version: record.version,
                });
            }
        }
    }

    report
}

/// Build a [`SyncStatus`] snapshot from a [`CursorState`] + journal counts.
///
/// `last_full_sync_at_iso` is derived from `cursor.last_full_sync_at_ms` —
/// we surface ISO-8601 to the UI for consistency with the rest of the wire
/// protocol; `None` is preserved.
pub fn build_sync_status(
    cursor: &CursorState,
    dirty_count: usize,
    pending_tombstone_count: usize,
) -> SyncStatus {
    SyncStatus {
        cursor: cursor.cursor,
        device_id: cursor.device_id.clone(),
        last_full_sync_at_iso: cursor.last_full_sync_at_ms.map(ms_to_iso8601),
        dirty_count,
        pending_tombstone_count,
    }
}

// ── private helpers ──────────────────────────────────────────────────────────

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut acc, b| {
            use std::fmt::Write;
            let _ = write!(&mut acc, "{b:02x}");
            acc
        })
}

/// Parse a 64-char lowercase or uppercase hex string into a 32-byte SHA-256.
/// Returns `None` for any malformed input.
fn parse_hex_hash(hex: &str) -> Option<[u8; 32]> {
    if hex.len() != 64 {
        return None;
    }
    let bytes_iter = hex.as_bytes().chunks_exact(2);
    let mut out = [0u8; 32];
    for (i, pair) in bytes_iter.enumerate() {
        let high = hex_nibble(pair[0])?;
        let low = hex_nibble(pair[1])?;
        out[i] = (high << 4) | low;
    }
    Some(out)
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Convert a Unix-epoch milliseconds value into an ISO-8601 UTC string.
///
/// We don't pull in `chrono` for this — the project's existing crates
/// (`std`, `uuid`, `sha2`, `serde`, `rusqlite`) don't include a date
/// formatter, so we hand-roll. Format: `YYYY-MM-DDThh:mm:ss.sssZ`.
fn ms_to_iso8601(ms: i64) -> String {
    // Decompose into seconds + sub-second milliseconds.
    let (secs, sub_ms) = if ms >= 0 {
        (ms / 1_000, (ms % 1_000) as u32)
    } else {
        // Round toward negative infinity for the seconds and keep sub_ms
        // non-negative.
        let secs = (ms - 999) / 1_000;
        let sub = (ms - secs * 1_000) as u32;
        (secs, sub)
    };

    let (y, mo, d, h, mi, s) = unix_secs_to_civil(secs);
    format!(
        "{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{sub_ms:03}Z",
        sub_ms = sub_ms
    )
}

/// Convert a Unix-epoch seconds value to civil (UTC) date/time fields.
///
/// Algorithm from Howard Hinnant's date library — well-known, integer-only,
/// works across the whole `i64` range.
fn unix_secs_to_civil(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let time_of_day = secs.rem_euclid(86_400) as u32;
    let h = time_of_day / 3_600;
    let mi = (time_of_day % 3_600) / 60;
    let s = time_of_day % 60;

    // Hinnant's civil_from_days, shifted so day 0 = 1970-01-01.
    let z = days + 719_468;
    let era = if z >= 0 { z / 146_097 } else { (z - 146_096) / 146_097 };
    let doe = (z - era * 146_097) as u64; // [0, 146_096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp.wrapping_sub(9) }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };

    (y as i32, m as u32, d as u32, h, mi, s)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::types::{ItemPullPage, ItemRecord};

    fn local_source(id: &str, category: &str, content: &str) -> LocalItemSource {
        LocalItemSource {
            item_id: id.into(),
            category_id: category.into(),
            content: content.into(),
            is_tombstone: false,
        }
    }

    fn tombstone_source(id: &str, category: &str) -> LocalItemSource {
        LocalItemSource {
            item_id: id.into(),
            category_id: category.into(),
            content: String::new(),
            is_tombstone: true,
        }
    }

    fn journal_dirty(item_id: &str, category: &str, last_hash: Option<[u8; 32]>) -> ItemJournalEntry {
        ItemJournalEntry {
            item_id: item_id.into(),
            category_id: category.into(),
            last_uploaded_hash: last_hash.map(|h| h.to_vec()),
            server_version: last_hash.map(|_| 1),
            is_dirty: true,
            is_tombstone: false,
        }
    }

    fn server_record(
        id: &str,
        category: &str,
        payload: Option<&str>,
        version: i64,
        deleted: bool,
    ) -> ItemRecord {
        let (payload_str, hash_hex) = match payload {
            Some(p) => {
                let (_, hex) = compute_content_hash(p.as_bytes());
                (Some(p.to_string()), Some(hex))
            }
            None => (None, None),
        };
        ItemRecord {
            id: id.into(),
            category_id: category.into(),
            payload: payload_str,
            content_hash_hex: hash_hex,
            version,
            deleted,
            deleted_at_iso: deleted.then(|| "2026-05-04T00:00:00.000Z".to_string()),
            updated_at_iso: Some("2026-05-04T00:00:00.000Z".to_string()),
        }
    }

    // ── compute_content_hash ─────────────────────────────────────────────────

    #[test]
    fn compute_content_hash_matches_known_sha256_vector() {
        let (bytes, hex) = compute_content_hash(b"");
        assert_eq!(
            hex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "empty input must hash to RFC-3174 known vector"
        );
        assert_eq!(bytes.len(), 32);

        // "abc" → ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        let (_, hex_abc) = compute_content_hash(b"abc");
        assert_eq!(
            hex_abc, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    // ── decide_uploads ───────────────────────────────────────────────────────

    #[test]
    fn decide_uploads_includes_dirty_items() {
        // Local source's hash differs from journal's last_uploaded_hash AND
        // the journal entry is dirty → PushItem.
        let plaintext = "new content";
        let (_, _) = compute_content_hash(plaintext.as_bytes());
        let stale_hash = [0xAAu8; 32];
        let journal = vec![journal_dirty("item-1", "snippets", Some(stale_hash))];
        let local = vec![local_source("item-1", "snippets", plaintext)];

        let decisions = decide_uploads(&local, &journal);
        assert_eq!(decisions.len(), 1);
        match &decisions[0] {
            UploadDecision::PushItem {
                item_id,
                category_id,
                plaintext: pt,
                content_hash,
            } => {
                assert_eq!(item_id, "item-1");
                assert_eq!(category_id, "snippets");
                assert_eq!(pt, "new content");
                let (expected_hash, _) = compute_content_hash(b"new content");
                assert_eq!(*content_hash, expected_hash);
            }
            other => panic!("expected PushItem, got {other:?}"),
        }
    }

    #[test]
    fn decide_uploads_excludes_clean_items() {
        // Local source's hash matches journal's last_uploaded_hash and
        // is_tombstone=false → Skip.
        let plaintext = "stable content";
        let (hash_bytes, _) = compute_content_hash(plaintext.as_bytes());
        let journal = vec![journal_dirty("item-1", "snippets", Some(hash_bytes))];
        let local = vec![local_source("item-1", "snippets", plaintext)];

        let decisions = decide_uploads(&local, &journal);
        assert_eq!(decisions.len(), 1);
        assert!(matches!(
            decisions[0],
            UploadDecision::Skip { ref item_id } if item_id == "item-1"
        ));
    }

    #[test]
    fn decide_uploads_emits_tombstone_for_marked_tombstones() {
        let local = vec![tombstone_source("item-2", "snippets")];
        let decisions = decide_uploads(&local, &[]);
        assert_eq!(decisions.len(), 1);
        match &decisions[0] {
            UploadDecision::PushTombstone {
                item_id,
                category_id,
            } => {
                assert_eq!(item_id, "item-2");
                assert_eq!(category_id, "snippets");
            }
            other => panic!("expected PushTombstone, got {other:?}"),
        }
    }

    #[test]
    fn decide_uploads_chunks_at_max_batch_size_500() {
        // Build 1001 dirty live sources — they all need uploading; the
        // chunker splits them into [500, 500, 1].
        let local: Vec<LocalItemSource> = (0..1001)
            .map(|i| local_source(&format!("id-{i:04}"), "snippets", &format!("body-{i}")))
            .collect();
        let decisions = decide_uploads(&local, &[]);
        assert_eq!(decisions.len(), 1001);

        let chunks = chunk_for_upload(decisions);
        let sizes: Vec<usize> = chunks.iter().map(|c| c.len()).collect();
        assert_eq!(sizes, vec![500, 500, 1]);
    }

    #[test]
    fn decide_uploads_respects_max_payload_per_item_256kb() {
        let exactly_256k: String = "a".repeat(MAX_ITEM_PAYLOAD_BYTES);
        let too_big: String = "a".repeat(MAX_ITEM_PAYLOAD_BYTES + 1);

        let local = vec![
            local_source("ok", "snippets", &exactly_256k),
            local_source("oversize", "snippets", &too_big),
        ];
        let decisions = decide_uploads(&local, &[]);
        assert!(matches!(decisions[0], UploadDecision::PushItem { .. }));
        match &decisions[1] {
            UploadDecision::DropOversize { size_bytes, .. } => {
                assert_eq!(*size_bytes, MAX_ITEM_PAYLOAD_BYTES + 1);
            }
            other => panic!("expected DropOversize, got {other:?}"),
        }
    }

    #[test]
    fn decide_uploads_drops_oversize_items_with_diagnostic() {
        let too_big: String = "x".repeat(MAX_ITEM_PAYLOAD_BYTES + 17);
        let local = vec![local_source("big-1", "snippets", &too_big)];

        let decisions = decide_uploads(&local, &[]);
        assert_eq!(decisions.len(), 1);
        match &decisions[0] {
            UploadDecision::DropOversize {
                item_id,
                category_id,
                size_bytes,
            } => {
                assert_eq!(item_id, "big-1");
                assert_eq!(category_id, "snippets");
                assert_eq!(*size_bytes, MAX_ITEM_PAYLOAD_BYTES + 17);
            }
            other => panic!("expected DropOversize, got {other:?}"),
        }
    }

    #[test]
    fn decide_uploads_appends_journal_only_tombstones_at_end() {
        // Provider has forgotten about a tombstoned item, but the journal
        // still owes the server a delete for it. We should still emit a
        // PushTombstone for the journal-only item.
        let local = vec![local_source("item-live", "snippets", "alive")];
        let journal = vec![ItemJournalEntry {
            item_id: "item-gone".into(),
            category_id: "snippets".into(),
            last_uploaded_hash: None,
            server_version: None,
            is_dirty: true,
            is_tombstone: true,
        }];
        let decisions = decide_uploads(&local, &journal);
        assert_eq!(decisions.len(), 2);
        assert!(matches!(decisions[0], UploadDecision::PushItem { .. }));
        match &decisions[1] {
            UploadDecision::PushTombstone { item_id, .. } => {
                assert_eq!(item_id, "item-gone")
            }
            other => panic!("expected trailing PushTombstone, got {other:?}"),
        }
    }

    // ── chunk_for_upload ─────────────────────────────────────────────────────

    #[test]
    fn chunk_for_upload_drops_skip_and_oversize_decisions() {
        let decisions = vec![
            UploadDecision::PushItem {
                item_id: "a".into(),
                category_id: "snippets".into(),
                plaintext: "p".into(),
                content_hash: [0u8; 32],
            },
            UploadDecision::Skip {
                item_id: "b".into(),
            },
            UploadDecision::DropOversize {
                item_id: "c".into(),
                category_id: "snippets".into(),
                size_bytes: 999_999,
            },
            UploadDecision::PushTombstone {
                item_id: "d".into(),
                category_id: "snippets".into(),
            },
        ];
        let chunks = chunk_for_upload(decisions);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].len(), 2);
        assert_eq!(chunks[0][0].id, "a");
        assert_eq!(chunks[0][0].deleted, None);
        assert_eq!(chunks[0][0].payload.as_deref(), Some("p"));
        assert_eq!(chunks[0][1].id, "d");
        assert_eq!(chunks[0][1].deleted, Some(true));
        assert_eq!(chunks[0][1].payload, None);
        assert_eq!(chunks[0][1].content_hash_hex, None);
    }

    #[test]
    fn chunk_for_upload_returns_empty_when_no_pushes() {
        let decisions = vec![
            UploadDecision::Skip {
                item_id: "a".into(),
            },
            UploadDecision::DropOversize {
                item_id: "b".into(),
                category_id: "snippets".into(),
                size_bytes: 1,
            },
        ];
        let chunks = chunk_for_upload(decisions);
        assert!(chunks.is_empty());
    }

    // ── merge_pull ───────────────────────────────────────────────────────────

    #[test]
    fn merge_pull_emits_upserts_for_new_items() {
        let server_page = ItemPullPage {
            items: vec![server_record("new-1", "snippets", Some("hello"), 4, false)],
            server_version: 4,
            has_more: false,
        };
        let report = merge_pull(&server_page, |_id| None);
        assert_eq!(report.actions.len(), 1);
        assert!(report.lww_warnings.is_empty());
        match &report.actions[0] {
            DownloadDecision::ApplyUpsert {
                item_id,
                category_id,
                plaintext,
                server_version,
                ..
            } => {
                assert_eq!(item_id, "new-1");
                assert_eq!(category_id, "snippets");
                assert_eq!(plaintext, "hello");
                assert_eq!(*server_version, 4);
            }
            other => panic!("expected ApplyUpsert, got {other:?}"),
        }
    }

    #[test]
    fn merge_pull_emits_deletes_for_tombstone_items() {
        let server_page = ItemPullPage {
            items: vec![server_record("dead-1", "snippets", None, 9, true)],
            server_version: 9,
            has_more: false,
        };
        let report = merge_pull(&server_page, |_id| None);
        assert_eq!(report.actions.len(), 1);
        match &report.actions[0] {
            DownloadDecision::ApplyDelete {
                item_id,
                category_id,
                server_version,
            } => {
                assert_eq!(item_id, "dead-1");
                assert_eq!(category_id, "snippets");
                assert_eq!(*server_version, 9);
            }
            other => panic!("expected ApplyDelete, got {other:?}"),
        }
    }

    #[test]
    fn merge_pull_returns_lww_warning_when_local_dirty_and_server_newer() {
        let plaintext = "server wins";
        let server_page = ItemPullPage {
            items: vec![server_record("conflict-1", "snippets", Some(plaintext), 5, false)],
            server_version: 5,
            has_more: false,
        };
        let local_dirty = ItemJournalEntry {
            item_id: "conflict-1".into(),
            category_id: "snippets".into(),
            last_uploaded_hash: Some(vec![0xAAu8; 32]),
            server_version: Some(2), // older than server
            is_dirty: true,
            is_tombstone: false,
        };
        let report = merge_pull(&server_page, |id| {
            if id == "conflict-1" {
                Some(local_dirty.clone())
            } else {
                None
            }
        });
        assert_eq!(report.actions.len(), 1);
        assert!(matches!(
            report.actions[0],
            DownloadDecision::ApplyUpsert { ref item_id, .. } if item_id == "conflict-1"
        ));
        assert_eq!(report.lww_warnings, vec!["conflict-1".to_string()]);
    }

    #[test]
    fn merge_pull_keeps_local_when_server_version_equals_journal() {
        let plaintext = "stable";
        let (hash_bytes, _) = compute_content_hash(plaintext.as_bytes());

        let server_page = ItemPullPage {
            items: vec![server_record("same-1", "snippets", Some(plaintext), 7, false)],
            server_version: 7,
            has_more: false,
        };
        let local = ItemJournalEntry {
            item_id: "same-1".into(),
            category_id: "snippets".into(),
            last_uploaded_hash: Some(hash_bytes.to_vec()),
            server_version: Some(7),
            is_dirty: false,
            is_tombstone: false,
        };
        let report = merge_pull(&server_page, |id| {
            if id == "same-1" {
                Some(local.clone())
            } else {
                None
            }
        });
        assert_eq!(report.actions.len(), 1);
        assert!(matches!(
            report.actions[0],
            DownloadDecision::Skip { ref item_id } if item_id == "same-1"
        ));
        assert!(report.lww_warnings.is_empty());
    }

    // ── build_sync_status ────────────────────────────────────────────────────

    #[test]
    fn build_sync_status_renders_iso_from_ms() {
        let cursor = CursorState {
            cursor: 17,
            device_id: "device-uuid".into(),
            // 2026-05-04T01:02:03.456Z → epoch ms
            last_full_sync_at_ms: Some(1_777_856_523_456),
        };
        let status = build_sync_status(&cursor, 3, 1);
        assert_eq!(status.cursor, 17);
        assert_eq!(status.device_id, "device-uuid");
        assert_eq!(status.dirty_count, 3);
        assert_eq!(status.pending_tombstone_count, 1);
        assert_eq!(
            status.last_full_sync_at_iso.as_deref(),
            Some("2026-05-04T01:02:03.456Z")
        );
    }

    #[test]
    fn build_sync_status_handles_none_last_sync() {
        let cursor = CursorState {
            cursor: 0,
            device_id: "device-uuid".into(),
            last_full_sync_at_ms: None,
        };
        let status = build_sync_status(&cursor, 0, 0);
        assert!(status.last_full_sync_at_iso.is_none());
    }
}
