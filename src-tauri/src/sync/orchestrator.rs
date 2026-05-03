//! Pure-function decision logic for per-category sync.
//!
//! Splitting upload-side decisions from download-side decisions keeps
//! each function dead simple to test: each takes a snapshot of the
//! relevant state and returns a Vec of actions, no I/O. The Tauri
//! command layer wraps these in HTTP + DB writes.

use crate::storage::cloud_sync_state::LocalJournalEntry;
use crate::sync::types::{
    CategoryListEntry, DownloadDecision, SyncStatus, UploadDecision, UploadReason,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// SHA-256 the plaintext and return both raw bytes (for journaling)
/// and hex (for the wire). Single-pass, no allocations beyond the
/// hex string.
pub fn sha256_with_hex(plaintext: &[u8]) -> ([u8; 32], String) {
    let mut hasher = Sha256::new();
    hasher.update(plaintext);
    let digest = hasher.finalize();
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&digest);
    let hex = bytes.iter().fold(String::with_capacity(64), |mut acc, b| {
        use std::fmt::Write;
        let _ = write!(&mut acc, "{b:02x}");
        acc
    });
    (bytes, hex)
}

/// Decide which categories need uploading.
///
/// `local_categories` is the registered providers' current state — one
/// entry per provider, `(category_id, plaintext)`. `journal` is the
/// last-uploaded hashes. Returns one decision per local category in the
/// same order as the input.
pub fn decide_uploads(
    local_categories: &[(String, String)],
    journal: &[LocalJournalEntry],
) -> Vec<UploadDecision> {
    let journal_map: HashMap<&str, &[u8]> = journal
        .iter()
        .map(|j| (j.category_id.as_str(), j.last_uploaded_hash.as_slice()))
        .collect();

    local_categories
        .iter()
        .map(|(category_id, plaintext)| {
            let (hash_bytes, _) = sha256_with_hex(plaintext.as_bytes());
            match journal_map.get(category_id.as_str()) {
                None => UploadDecision::Upload {
                    category_id: category_id.clone(),
                    plaintext: plaintext.clone(),
                    content_hash: hash_bytes,
                    reason: UploadReason::FirstUpload,
                },
                Some(last_hash) if *last_hash == hash_bytes.as_slice() => {
                    UploadDecision::Skip {
                        category_id: category_id.clone(),
                    }
                }
                Some(_) => UploadDecision::Upload {
                    category_id: category_id.clone(),
                    plaintext: plaintext.clone(),
                    content_hash: hash_bytes,
                    reason: UploadReason::LocalChangedSinceUpload,
                },
            }
        })
        .collect()
}

/// Decide which categories on the server need downloading.
///
/// Server hashes come in as hex (the wire format). Compares against the
/// journal's stored bytes. A server-side category whose hash matches
/// the journal is already locally in sync and skipped.
pub fn decide_downloads(
    server_list: &[CategoryListEntry],
    journal: &[LocalJournalEntry],
) -> Vec<DownloadDecision> {
    let journal_map: HashMap<&str, String> = journal
        .iter()
        .map(|j| (j.category_id.as_str(), bytes_to_hex(&j.last_uploaded_hash)))
        .collect();

    server_list
        .iter()
        .map(|entry| {
            match journal_map.get(entry.category_id.as_str()) {
                Some(local_hex) if local_hex.eq_ignore_ascii_case(&entry.content_hash_hex) => {
                    DownloadDecision::Skip {
                        category_id: entry.category_id.clone(),
                    }
                }
                _ => DownloadDecision::Download {
                    category_id: entry.category_id.clone(),
                },
            }
        })
        .collect()
}

/// Build the privacy-UI status from the server's category list.
pub fn aggregate_status(server_list: &[CategoryListEntry]) -> SyncStatus {
    let last = server_list
        .iter()
        .map(|e| e.synced_at_iso.clone())
        .max();
    SyncStatus {
        last_synced_at_iso: last,
        category_count: server_list.len(),
    }
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut acc, b| {
        use std::fmt::Write;
        let _ = write!(&mut acc, "{b:02x}");
        acc
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn journal_entry(category_id: &str, hash_byte: u8) -> LocalJournalEntry {
        LocalJournalEntry {
            category_id: category_id.to_string(),
            last_uploaded_hash: vec![hash_byte; 32],
            last_synced_at_ms: 1,
        }
    }

    fn server_entry(category_id: &str, hash_hex: &str) -> CategoryListEntry {
        CategoryListEntry {
            category_id: category_id.to_string(),
            content_hash_hex: hash_hex.to_string(),
            synced_at_iso: "2026-05-04T00:00:00Z".to_string(),
        }
    }

    // ── sha256_with_hex ──────────────────────────────────────────────────

    #[test]
    fn sha256_empty_input_known_digest() {
        let (bytes, hex) = sha256_with_hex(b"");
        assert_eq!(
            hex,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(bytes.len(), 32);
    }

    #[test]
    fn sha256_same_input_same_digest() {
        let (a_bytes, a_hex) = sha256_with_hex(b"hello world");
        let (b_bytes, b_hex) = sha256_with_hex(b"hello world");
        assert_eq!(a_bytes, b_bytes);
        assert_eq!(a_hex, b_hex);
    }

    #[test]
    fn sha256_different_inputs_different_digests() {
        let (a, _) = sha256_with_hex(b"a");
        let (b, _) = sha256_with_hex(b"b");
        assert_ne!(a, b);
    }

    #[test]
    fn sha256_output_is_64_hex_chars() {
        let (_, hex) = sha256_with_hex(b"any input");
        assert_eq!(hex.len(), 64);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    // ── decide_uploads ───────────────────────────────────────────────────

    #[test]
    fn decide_uploads_first_upload_when_journal_empty() {
        let local = vec![("settings".into(), "abc".into())];
        let decisions = decide_uploads(&local, &[]);
        assert_eq!(decisions.len(), 1);
        match &decisions[0] {
            UploadDecision::Upload {
                category_id,
                reason,
                ..
            } => {
                assert_eq!(category_id, "settings");
                assert_eq!(reason, &UploadReason::FirstUpload);
            }
            other => panic!("expected Upload(FirstUpload), got {other:?}"),
        }
    }

    #[test]
    fn decide_uploads_skips_when_journal_hash_matches_plaintext() {
        let plaintext = "{\"version\":1}";
        let (hash_bytes, _) = sha256_with_hex(plaintext.as_bytes());
        let journal = vec![LocalJournalEntry {
            category_id: "settings".into(),
            last_uploaded_hash: hash_bytes.to_vec(),
            last_synced_at_ms: 1,
        }];
        let local = vec![("settings".into(), plaintext.to_string())];

        let decisions = decide_uploads(&local, &journal);
        assert!(matches!(
            decisions[0],
            UploadDecision::Skip { ref category_id } if category_id == "settings"
        ));
    }

    #[test]
    fn decide_uploads_uploads_when_local_changed() {
        let journal = vec![journal_entry("settings", 0xAA)];
        let local = vec![("settings".into(), "different content".into())];

        let decisions = decide_uploads(&local, &journal);
        match &decisions[0] {
            UploadDecision::Upload { reason, .. } => {
                assert_eq!(reason, &UploadReason::LocalChangedSinceUpload);
            }
            other => panic!("expected Upload(LocalChangedSinceUpload), got {other:?}"),
        }
    }

    #[test]
    fn decide_uploads_handles_multiple_categories_independently() {
        let plaintext_a = "a-payload";
        let (hash_a, _) = sha256_with_hex(plaintext_a.as_bytes());
        let journal = vec![
            LocalJournalEntry {
                category_id: "a".into(),
                last_uploaded_hash: hash_a.to_vec(),
                last_synced_at_ms: 1,
            },
            journal_entry("b", 0xFF),
        ];
        let local = vec![
            ("a".into(), plaintext_a.into()),    // unchanged
            ("b".into(), "new b content".into()), // changed
            ("c".into(), "fresh".into()),        // never uploaded
        ];

        let decisions = decide_uploads(&local, &journal);
        assert_eq!(decisions.len(), 3);
        assert!(matches!(decisions[0], UploadDecision::Skip { .. }));
        assert!(matches!(
            decisions[1],
            UploadDecision::Upload {
                reason: UploadReason::LocalChangedSinceUpload,
                ..
            }
        ));
        assert!(matches!(
            decisions[2],
            UploadDecision::Upload {
                reason: UploadReason::FirstUpload,
                ..
            }
        ));
    }

    #[test]
    fn decide_uploads_preserves_input_order() {
        let local = vec![
            ("z".into(), "zz".into()),
            ("a".into(), "aa".into()),
            ("m".into(), "mm".into()),
        ];
        let decisions = decide_uploads(&local, &[]);
        let ids: Vec<_> = decisions
            .iter()
            .map(|d| match d {
                UploadDecision::Upload { category_id, .. } => category_id.clone(),
                UploadDecision::Skip { category_id } => category_id.clone(),
            })
            .collect();
        assert_eq!(ids, vec!["z", "a", "m"]);
    }

    // ── decide_downloads ─────────────────────────────────────────────────

    #[test]
    fn decide_downloads_marks_unknown_categories_as_download() {
        let server = vec![server_entry("settings", "abc123")];
        let decisions = decide_downloads(&server, &[]);
        assert!(matches!(
            decisions[0],
            DownloadDecision::Download { ref category_id } if category_id == "settings"
        ));
    }

    #[test]
    fn decide_downloads_skips_when_journal_hash_matches() {
        // Build a known hash + matching journal entry.
        let plaintext = "stable content";
        let (bytes, hex) = sha256_with_hex(plaintext.as_bytes());
        let server = vec![server_entry("settings", &hex)];
        let journal = vec![LocalJournalEntry {
            category_id: "settings".into(),
            last_uploaded_hash: bytes.to_vec(),
            last_synced_at_ms: 1,
        }];

        let decisions = decide_downloads(&server, &journal);
        assert!(matches!(decisions[0], DownloadDecision::Skip { .. }));
    }

    #[test]
    fn decide_downloads_compares_hex_case_insensitively() {
        let plaintext = "case-test";
        let (bytes, hex_lower) = sha256_with_hex(plaintext.as_bytes());
        let server = vec![server_entry("c", &hex_lower.to_uppercase())]; // server returns uppercase
        let journal = vec![LocalJournalEntry {
            category_id: "c".into(),
            last_uploaded_hash: bytes.to_vec(),
            last_synced_at_ms: 1,
        }];

        let decisions = decide_downloads(&server, &journal);
        assert!(matches!(decisions[0], DownloadDecision::Skip { .. }));
    }

    #[test]
    fn decide_downloads_marks_changed_server_hash_as_download() {
        let server = vec![server_entry("settings", "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")];
        let journal = vec![journal_entry("settings", 0x00)];
        let decisions = decide_downloads(&server, &journal);
        assert!(matches!(decisions[0], DownloadDecision::Download { .. }));
    }

    #[test]
    fn decide_downloads_handles_empty_server_list() {
        let decisions = decide_downloads(&[], &[]);
        assert!(decisions.is_empty());
    }

    // ── aggregate_status ─────────────────────────────────────────────────

    #[test]
    fn aggregate_status_empty_returns_none() {
        let s = aggregate_status(&[]);
        assert!(s.last_synced_at_iso.is_none());
        assert_eq!(s.category_count, 0);
    }

    #[test]
    fn aggregate_status_picks_max_synced_at() {
        let server = vec![
            CategoryListEntry {
                category_id: "a".into(),
                content_hash_hex: "00".repeat(32),
                synced_at_iso: "2026-01-01T00:00:00Z".into(),
            },
            CategoryListEntry {
                category_id: "b".into(),
                content_hash_hex: "11".repeat(32),
                synced_at_iso: "2026-05-04T00:00:00Z".into(), // newest
            },
            CategoryListEntry {
                category_id: "c".into(),
                content_hash_hex: "22".repeat(32),
                synced_at_iso: "2026-03-15T00:00:00Z".into(),
            },
        ];
        let s = aggregate_status(&server);
        assert_eq!(s.last_synced_at_iso.as_deref(), Some("2026-05-04T00:00:00Z"));
        assert_eq!(s.category_count, 3);
    }
}
