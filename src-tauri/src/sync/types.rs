//! Wire DTOs and decision-tree types for the per-category cloud sync
//! orchestrator.

use serde::{Deserialize, Serialize};

/// One row from `GET /api/sync/categories`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryListEntry {
    pub category_id: String,
    /// Hex-encoded SHA-256 of the plaintext as the server saw it on
    /// upload. Always 64 hex chars.
    pub content_hash_hex: String,
    /// ISO-8601 UTC timestamp the server stamped on the upload.
    pub synced_at_iso: String,
}

/// Body of `GET /api/sync/category/{id}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryPayload {
    pub content_hash_hex: String,
    pub payload: String,
    pub synced_at_iso: String,
}

/// Body of `POST /api/sync/category/{id}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    pub content_hash_hex: String,
    pub payload: String,
}

/// Server response to the upload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub synced_at_iso: String,
}

/// Aggregate sync status for the privacy-tab UI and any future
/// "Last synced X ago" affordance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// Maximum `synced_at` across all categories, ISO-8601, or `None`
    /// if no category has ever synced.
    pub last_synced_at_iso: Option<String>,
    pub category_count: usize,
}

/// Why the orchestrator decided to upload a category.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum UploadReason {
    /// No journal entry exists — never uploaded before.
    FirstUpload,
    /// Local plaintext differs from what the journal says was last uploaded.
    LocalChangedSinceUpload,
}

/// What the orchestrator decided per category during the upload pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadDecision {
    /// Upload this category with the given plaintext + computed hash.
    Upload {
        category_id: String,
        plaintext: String,
        content_hash: [u8; 32],
        reason: UploadReason,
    },
    /// Skip — local hash matches journal, server already has the same.
    Skip { category_id: String },
}

/// What the orchestrator decided per server-side category during the
/// download pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DownloadDecision {
    /// Server has a category whose hash differs from our journal — pull
    /// it.
    Download { category_id: String },
    /// Server hash matches journal — already in sync, no fetch needed.
    Skip { category_id: String },
}
