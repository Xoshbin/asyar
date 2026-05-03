//! Tauri command layer for per-category cloud sync (Layer 4a).
//!
//! Three commands replace the old upload/download/status snapshot
//! triple. Each is a thin wrapper over an `_inner` pure function so
//! the orchestration logic is testable without a running Tauri app.

use crate::auth::api_client::ApiClient;
use crate::auth::state::AuthState;
use crate::error::AppError;
use crate::storage::cloud_sync_state::{self, LocalJournalEntry};
use crate::storage::DataStore;
use crate::sync::orchestrator::{
    aggregate_status, decide_downloads, decide_uploads,
};
use crate::sync::types::{
    DownloadDecision, SyncStatus, UploadDecision, UploadRequest,
};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Per-category cap. Categories larger than this are reported as
/// failures and skipped; other categories continue to upload.
pub const MAX_CATEGORY_BYTES: usize = 5 * 1024 * 1024;

/// Result of one upload pass over every registered provider.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRunReport {
    pub uploaded: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<SyncRunFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRunFailure {
    pub category_id: String,
    pub reason: String,
}

/// One downloaded category, ready for the TS layer to dispatch through
/// the matching `ISyncProvider.applyImport()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredCategory {
    pub category_id: String,
    pub plaintext: String,
}

// ── Tauri command surface ────────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_run(
    inputs: Vec<(String, String)>,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<SyncRunReport, AppError> {
    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))?;
    sync_run_inner(&inputs, &token, &api_client, &data_store).await
}

#[tauri::command]
pub async fn sync_restore(
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
    data_store: State<'_, DataStore>,
) -> Result<Vec<RestoredCategory>, AppError> {
    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))?;
    sync_restore_inner(&token, &api_client, &data_store).await
}

#[tauri::command]
pub async fn sync_get_status(
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
) -> Result<SyncStatus, AppError> {
    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))?;
    sync_get_status_inner(&token, &api_client).await
}

// ── _inner pure-but-async functions ──────────────────────────────────────────

/// Run one upload pass.
///
/// `inputs` is the list of registered providers' current state, one
/// `(category_id, plaintext)` tuple each. Categories whose plaintext
/// hash matches the local journal are skipped. Categories exceeding
/// `MAX_CATEGORY_BYTES` are reported as failures with `reason="oversized"`
/// — other categories continue uploading regardless.
///
/// On a successful per-category upload, the journal entry is updated
/// to the new hash + server-confirmed timestamp.
pub(crate) async fn sync_run_inner(
    inputs: &[(String, String)],
    token: &str,
    api_client: &ApiClient,
    data_store: &DataStore,
) -> Result<SyncRunReport, AppError> {
    let journal = {
        let conn = data_store.conn()?;
        cloud_sync_state::get_all(&conn)?
    };

    let decisions = decide_uploads(inputs, &journal);
    let mut report = SyncRunReport::default();

    for decision in decisions {
        match decision {
            UploadDecision::Skip { category_id } => {
                report.skipped.push(category_id);
            }
            UploadDecision::Upload {
                category_id,
                plaintext,
                content_hash,
                reason: _,
            } => {
                if plaintext.len() > MAX_CATEGORY_BYTES {
                    report.failed.push(SyncRunFailure {
                        category_id: category_id.clone(),
                        reason: format!(
                            "oversized: {} bytes (cap {} bytes)",
                            plaintext.len(),
                            MAX_CATEGORY_BYTES
                        ),
                    });
                    continue;
                }

                let hex = bytes_to_hex(&content_hash);
                let body = UploadRequest {
                    content_hash_hex: hex,
                    payload: plaintext,
                };

                match api_client
                    .upload_category(token, &category_id, &body)
                    .await
                {
                    Ok(response) => {
                        let synced_at_ms =
                            parse_iso_to_millis(&response.synced_at_iso).unwrap_or(0);
                        let entry = LocalJournalEntry {
                            category_id: category_id.clone(),
                            last_uploaded_hash: content_hash.to_vec(),
                            last_synced_at_ms: synced_at_ms,
                        };
                        let conn = data_store.conn()?;
                        cloud_sync_state::upsert(&conn, &entry)?;
                        report.uploaded.push(category_id);
                    }
                    Err(e) => {
                        report.failed.push(SyncRunFailure {
                            category_id,
                            reason: e.to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(report)
}

/// Pull every server-side category whose hash differs from the local
/// journal's entry, returning `(category_id, plaintext)` tuples for the
/// caller to dispatch through the matching `ISyncProvider`.
pub(crate) async fn sync_restore_inner(
    token: &str,
    api_client: &ApiClient,
    data_store: &DataStore,
) -> Result<Vec<RestoredCategory>, AppError> {
    let server_list = api_client.list_categories(token).await?;
    let journal = {
        let conn = data_store.conn()?;
        cloud_sync_state::get_all(&conn)?
    };

    let decisions = decide_downloads(&server_list, &journal);
    let mut restored = Vec::new();

    for decision in decisions {
        if let DownloadDecision::Download { category_id } = decision {
            if let Some(payload) = api_client.download_category(token, &category_id).await? {
                // Update the journal so subsequent ticks see the
                // server's authoritative state.
                if let Ok(hash_bytes) = hex_to_bytes(&payload.content_hash_hex) {
                    let synced_at_ms =
                        parse_iso_to_millis(&payload.synced_at_iso).unwrap_or(0);
                    let entry = LocalJournalEntry {
                        category_id: category_id.clone(),
                        last_uploaded_hash: hash_bytes,
                        last_synced_at_ms: synced_at_ms,
                    };
                    let conn = data_store.conn()?;
                    cloud_sync_state::upsert(&conn, &entry)?;
                }
                restored.push(RestoredCategory {
                    category_id,
                    plaintext: payload.payload,
                });
            }
            // 404 (`payload.is_none()`) means the server-side row was
            // deleted between the list call and the per-category fetch.
            // Leave the journal alone; the next tick reconciles.
        }
    }

    Ok(restored)
}

pub(crate) async fn sync_get_status_inner(
    token: &str,
    api_client: &ApiClient,
) -> Result<SyncStatus, AppError> {
    let list = api_client.list_categories(token).await?;
    Ok(aggregate_status(&list))
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut acc, b| {
        use std::fmt::Write;
        let _ = write!(&mut acc, "{b:02x}");
        acc
    })
}

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, AppError> {
    if !hex.len().is_multiple_of(2) {
        return Err(AppError::Validation("hex must be even-length".into()));
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&hex[i..i + 2], 16)
                .map_err(|e| AppError::Validation(format!("invalid hex: {e}")))
        })
        .collect()
}

/// Best-effort conversion of an ISO-8601 timestamp to Unix
/// milliseconds. Falls back to `0` (so the journal still records the
/// upload) if the server returns a malformed timestamp. The journal's
/// `last_synced_at_ms` is a UI affordance, not load-bearing.
fn parse_iso_to_millis(iso: &str) -> Result<i64, AppError> {
    let trimmed = iso.trim_end_matches('Z');
    let (date_part, time_part) = trimmed
        .split_once('T')
        .ok_or_else(|| AppError::Validation(format!("not ISO-8601: {iso}")))?;
    let mut date_iter = date_part.split('-');
    let year: i64 = date_iter
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Validation("year".into()))?;
    let month: i64 = date_iter
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Validation("month".into()))?;
    let day: i64 = date_iter
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Validation("day".into()))?;

    // Strip fractional seconds if present.
    let time_main = time_part.split('.').next().unwrap_or(time_part);
    let mut time_iter = time_main.split(':');
    let hour: i64 = time_iter
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Validation("hour".into()))?;
    let minute: i64 = time_iter
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Validation("minute".into()))?;
    let second: i64 = time_iter
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::Validation("second".into()))?;

    // Days-from-civil — Howard Hinnant's algorithm, lossy below seconds.
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days_from_epoch = era * 146097 + doe - 719468;
    let total_seconds = days_from_epoch * 86400 + hour * 3600 + minute * 60 + second;
    Ok(total_seconds * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_iso_known_value_in_2026_range() {
        let ms = parse_iso_to_millis("2026-05-04T00:00:00Z").unwrap();
        assert!(ms > 1_700_000_000_000);
        assert!(ms < 2_000_000_000_000);
    }

    #[test]
    fn parse_iso_handles_fractional_seconds() {
        let ms = parse_iso_to_millis("2026-05-04T00:00:00.123Z").unwrap();
        assert_eq!(ms % 1000, 0);
    }

    #[test]
    fn parse_iso_rejects_malformed() {
        assert!(parse_iso_to_millis("not-a-timestamp").is_err());
    }

    #[test]
    fn hex_round_trip() {
        let bytes = vec![0xDE, 0xAD, 0xBE, 0xEF];
        let hex = bytes_to_hex(&bytes);
        assert_eq!(hex, "deadbeef");
        let back = hex_to_bytes(&hex).unwrap();
        assert_eq!(back, bytes);
    }

    #[test]
    fn hex_to_bytes_rejects_odd_length() {
        assert!(hex_to_bytes("abc").is_err());
    }

    #[test]
    fn hex_to_bytes_rejects_non_hex() {
        assert!(hex_to_bytes("zz").is_err());
    }

    #[test]
    fn sync_run_report_serializes_with_camel_case() {
        let r = SyncRunReport {
            uploaded: vec!["snippets".into()],
            skipped: vec!["settings".into()],
            failed: vec![SyncRunFailure {
                category_id: "clipboard".into(),
                reason: "oversized".into(),
            }],
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"uploaded\":[\"snippets\"]"));
        assert!(json.contains("\"skipped\":[\"settings\"]"));
        assert!(json.contains("\"categoryId\":\"clipboard\""));
    }

    #[test]
    fn restored_category_serializes_with_camel_case() {
        let r = RestoredCategory {
            category_id: "snippets".into(),
            plaintext: "{\"version\":1}".into(),
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"categoryId\":\"snippets\""));
        assert!(json.contains("\"plaintext\""));
    }

    #[test]
    fn max_category_bytes_const_is_5_mb() {
        assert_eq!(MAX_CATEGORY_BYTES, 5 * 1024 * 1024);
    }
}
