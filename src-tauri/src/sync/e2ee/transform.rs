//! Encryption seam between `decide_uploads` and `chunk_for_upload`,
//! and decryption seam after `merge_pull`.
//!
//! When `Mode::On`, every payload that travels in a `PushItem`
//! decision or comes back as an `ItemRecord.payload` is replaced with
//! `enc:v1:<base64>` ciphertext. When `Mode::Off`, both functions are
//! identity.
//!
//! Tombstones (`PushTombstone`, `ApplyDelete`, `ItemRecord` with
//! `payload: None`) carry no plaintext and pass through unchanged
//! regardless of mode.

use crate::crypto::sync_envelope;
use crate::error::AppError;
use crate::sync::e2ee::mode::Mode;
use crate::sync::types::{ItemPullPage, UploadDecision};

/// Encrypt the plaintext field of every `PushItem` decision when E2EE is on.
/// `PushTombstone`, `Skip`, and `DropOversize` are identity in both modes.
pub fn encrypt_decisions(
    mode: &Mode,
    decisions: Vec<UploadDecision>,
) -> Result<Vec<UploadDecision>, AppError> {
    let Mode::On { master_seed, .. } = mode else {
        return Ok(decisions);
    };
    decisions
        .into_iter()
        .map(|d| -> Result<UploadDecision, AppError> {
            match d {
                UploadDecision::PushItem {
                    item_id,
                    category_id,
                    plaintext,
                    content_hash,
                } => {
                    let ciphertext = sync_envelope::encrypt_payload(&plaintext, master_seed)?;
                    Ok(UploadDecision::PushItem {
                        item_id,
                        category_id,
                        plaintext: ciphertext,
                        content_hash,
                    })
                }
                other => Ok(other),
            }
        })
        .collect()
}

/// Decrypt the `payload` of every live `ItemRecord` in the pull page
/// when E2EE is on. Tombstones (`payload: None`) are skipped, and so
/// are plaintext payloads (no `enc:v1:` prefix).
///
/// **Mixed-mode tolerance is load-bearing.** When a user enables E2EE
/// on an account that already has plaintext rows on the server (from
/// pre-enrolment pushes), enrolment marks every local journal row
/// dirty so the next sync push re-uploads each item as ciphertext.
/// But Layer 4a's `sync_run` flow pulls *before* it pushes — meaning
/// the launcher will see those still-plaintext rows on its first
/// post-enrolment pull, *before* the re-upload has had a chance to
/// replace them. Treating those rows as ciphertext and trying to AEAD-
/// decrypt them is wrong: it crashes the sync run, blocking the very
/// push that would unstick the migration.
///
/// The fix is to identify plaintext via [`crate::crypto::cipher::is_encrypted_value`]
/// (a cheap prefix check) and pass it through unchanged. Once the
/// post-enrolment push completes, every server row is ciphertext and
/// this branch becomes dead in practice — but the code stays defensive
/// in case a future flow (per-item opt-out, partial-encryption) ever
/// re-introduces a mixed state.
pub fn decrypt_pull_page(
    mode: &Mode,
    mut page: ItemPullPage,
) -> Result<ItemPullPage, AppError> {
    let Mode::On { master_seed, .. } = mode else {
        return Ok(page);
    };
    for item in page.items.iter_mut() {
        if let Some(payload) = item.payload.as_mut() {
            if crate::crypto::cipher::is_encrypted_value(payload) {
                *payload = sync_envelope::decrypt_payload(payload, master_seed)?;
            }
            // else: plaintext from a pre-enrolment push; leave as-is.
            // The launcher's local mark-all-dirty + next-tick push will
            // overwrite this row's server-side payload with ciphertext.
        }
    }
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::types::ItemRecord;
    use zeroize::Zeroizing;

    fn on_mode() -> Mode {
        Mode::On {
            master_seed: Zeroizing::new([42u8; 32]),
            key_version: 1,
        }
    }

    fn push_item(id: &str, plaintext: &str) -> UploadDecision {
        UploadDecision::PushItem {
            item_id: id.into(),
            category_id: "clipboard".into(),
            plaintext: plaintext.into(),
            content_hash: [0u8; 32], // raw bytes; orchestrator-supplied in production
        }
    }

    fn push_tombstone(id: &str) -> UploadDecision {
        UploadDecision::PushTombstone {
            item_id: id.into(),
            category_id: "clipboard".into(),
        }
    }

    fn live_record(id: &str, payload: Option<&str>) -> ItemRecord {
        ItemRecord {
            id: id.into(),
            category_id: "clipboard".into(),
            payload: payload.map(|s| s.into()),
            content_hash_hex: None,
            version: 1,
            deleted: false,
            deleted_at_iso: None,
            updated_at_iso: Some("2026-05-04T12:00:00Z".into()),
        }
    }

    fn tombstone_record(id: &str) -> ItemRecord {
        ItemRecord {
            id: id.into(),
            category_id: "clipboard".into(),
            payload: None,
            content_hash_hex: None,
            version: 2,
            deleted: true,
            deleted_at_iso: Some("2026-05-04T12:00:00Z".into()),
            updated_at_iso: Some("2026-05-04T12:00:00Z".into()),
        }
    }

    fn page(items: Vec<ItemRecord>) -> ItemPullPage {
        ItemPullPage {
            items,
            server_version: 0,
            has_more: false,
        }
    }

    #[test]
    fn encrypt_off_is_identity() {
        let input = vec![push_item("a", "hello")];
        let out = encrypt_decisions(&Mode::Off, input.clone()).unwrap();
        assert_eq!(out, input);
    }

    #[test]
    fn encrypt_on_replaces_plaintext_with_ciphertext() {
        let mode = on_mode();
        let out = encrypt_decisions(&mode, vec![push_item("a", "secret")]).unwrap();
        match &out[0] {
            UploadDecision::PushItem { plaintext, .. } => {
                assert!(plaintext.starts_with("enc:v1:"));
                assert_ne!(plaintext, "secret");
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn encrypt_on_preserves_metadata_fields() {
        let mode = on_mode();
        let out = encrypt_decisions(&mode, vec![push_item("xyz", "secret")]).unwrap();
        match &out[0] {
            UploadDecision::PushItem {
                item_id,
                category_id,
                content_hash,
                ..
            } => {
                assert_eq!(item_id, "xyz");
                assert_eq!(category_id, "clipboard");
                assert_eq!(*content_hash, [0u8; 32]);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn encrypt_skips_non_pushitem_variants() {
        let mode = on_mode();
        let input = vec![
            push_tombstone("t1"),
            UploadDecision::Skip { item_id: "s1".into() },
            UploadDecision::DropOversize {
                item_id: "d1".into(),
                category_id: "clipboard".into(),
                size_bytes: 999_999,
            },
        ];
        let out = encrypt_decisions(&mode, input.clone()).unwrap();
        assert_eq!(out, input);
    }

    #[test]
    fn encrypt_then_decrypt_roundtrips() {
        let mode = on_mode();
        let plaintext = "{\"x\":1}";
        let encrypted = encrypt_decisions(&mode, vec![push_item("a", plaintext)]).unwrap();
        let ciphertext = match &encrypted[0] {
            UploadDecision::PushItem { plaintext, .. } => plaintext.clone(),
            _ => unreachable!(),
        };

        // Simulate what comes back from the server: an ItemRecord whose
        // payload is the ciphertext we just produced.
        let p = page(vec![live_record("a", Some(&ciphertext))]);
        let decrypted = decrypt_pull_page(&mode, p).unwrap();
        assert_eq!(decrypted.items[0].payload.as_deref(), Some(plaintext));
    }

    #[test]
    fn decrypt_off_is_identity() {
        let p = page(vec![live_record("a", Some("plain"))]);
        let out = decrypt_pull_page(&Mode::Off, p.clone()).unwrap();
        assert_eq!(out, p);
    }

    #[test]
    fn decrypt_skips_tombstones_with_no_payload() {
        let mode = on_mode();
        let p = page(vec![tombstone_record("t1")]);
        let out = decrypt_pull_page(&mode, p).unwrap();
        assert_eq!(out.items[0].payload, None);
    }

    #[test]
    fn decrypt_processes_mixed_live_and_tombstone() {
        let mode = on_mode();
        let plaintext = "alpha";
        let ct = sync_envelope::encrypt_payload(plaintext, &[42u8; 32]).unwrap();
        let p = page(vec![
            live_record("a", Some(&ct)),
            tombstone_record("t1"),
        ]);
        let out = decrypt_pull_page(&mode, p).unwrap();
        assert_eq!(out.items[0].payload.as_deref(), Some(plaintext));
        assert_eq!(out.items[1].payload, None);
    }

    /// Regression: when a user enables E2EE on an account that already has
    /// plaintext rows on the server (from pre-enrolment pushes), the first
    /// post-enrolment pull will see those still-plaintext rows. They must
    /// pass through `decrypt_pull_page` unchanged so the launcher can then
    /// push its now-dirty journal and overwrite them with ciphertext. Strict
    /// AEAD-decrypt of every row (the original implementation) crashed the
    /// sync run before the push could even start.
    #[test]
    fn decrypt_passes_through_plaintext_legacy_rows() {
        let mode = on_mode();
        let plaintext_legacy = r#"{"id":"abc","type":"text","content":"hello"}"#;
        let p = page(vec![live_record("legacy", Some(plaintext_legacy))]);
        let out = decrypt_pull_page(&mode, p).unwrap();
        assert_eq!(out.items[0].payload.as_deref(), Some(plaintext_legacy));
    }

    /// And the natural mix: a page containing a legacy-plaintext row and an
    /// e2ee-ciphertext row should produce two plaintexts on the way out.
    #[test]
    fn decrypt_handles_mixed_plaintext_and_ciphertext_in_same_page() {
        let mode = on_mode();
        let legacy_plaintext = r#"{"id":"old","type":"text"}"#;
        let new_plaintext = r#"{"id":"new","type":"text"}"#;
        let new_ct = sync_envelope::encrypt_payload(new_plaintext, &[42u8; 32]).unwrap();
        let p = page(vec![
            live_record("old", Some(legacy_plaintext)),
            live_record("new", Some(&new_ct)),
        ]);
        let out = decrypt_pull_page(&mode, p).unwrap();
        assert_eq!(out.items[0].payload.as_deref(), Some(legacy_plaintext));
        assert_eq!(out.items[1].payload.as_deref(), Some(new_plaintext));
    }
}
