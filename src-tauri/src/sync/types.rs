//! Wire DTOs and decision-tree types for the per-item delta-sync orchestrator.
//!
//! These types are the contract between the launcher and the cloud sync HTTP
//! API (`POST /api/sync/items`, `GET /api/sync/items`) and between the pure
//! orchestrator decision functions and the Tauri command layer that drives
//! them with real I/O.
//!
//! Wire shapes are `#[serde(rename_all = "camelCase")]`; on-the-wire `None`
//! fields are skipped via `skip_serializing_if = "Option::is_none"` to keep
//! the JSON small for tombstones.
//!
//! Decision-tree types ([`UploadDecision`], [`DownloadDecision`],
//! [`MergeReport`], [`LocalItemSource`]) are pure-Rust structures that the
//! orchestrator emits; they are not serialized to the network and intentionally
//! do not derive `Serialize`/`Deserialize`.

use serde::{Deserialize, Serialize};

// ── push (POST /api/sync/items) ──────────────────────────────────────────────

/// One item in a push batch sent from the launcher to `POST /api/sync/items`.
///
/// `payload` and `content_hash_hex` are present for live items, omitted /
/// `None` for tombstones (the wire encoding when serialized as JSON skips
/// `None` fields). When `deleted` is `Some(true)` the row is a tombstone;
/// `None` and `Some(false)` both indicate a live item — we serialize `None`
/// to keep the wire small.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPushItem {
    /// Stable item id (UUID assigned by the launcher when the item was first
    /// tracked locally).
    pub id: String,
    /// Category the item belongs to (`snippets`, `shortcuts`, ...).
    pub category_id: String,
    /// Hex-encoded SHA-256 of the plaintext payload. Omitted on tombstones.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash_hex: Option<String>,
    /// Plaintext payload as the provider emits it. Omitted on tombstones.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<String>,
    /// `Some(true)` for tombstones; `None` for live items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
}

/// Body of `POST /api/sync/items`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPushBatchRequest {
    /// The launcher's stable per-install device UUID.
    pub device_id: String,
    /// Items to push. Capped at [`crate::sync::orchestrator::MAX_BATCH_ITEM_COUNT`]
    /// per request by the orchestrator's chunker.
    pub items: Vec<ItemPushItem>,
}

/// One element of the response items[] from `POST /api/sync/items`.
///
/// The server assigns a monotonically-increasing version per item; this echo
/// lets the launcher record the version it should now consider authoritative.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPushAssignment {
    /// Item id (matches the `id` field of the corresponding push item).
    pub id: String,
    /// Server-assigned version after this push.
    pub version: i64,
}

/// Response body of `POST /api/sync/items`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPushBatchResponse {
    /// Per-item version assignments.
    pub items: Vec<ItemPushAssignment>,
    /// Server's max version after applying this batch — feeds the cursor
    /// `advance` step on the launcher side.
    pub server_version: i64,
}

// ── pull (GET /api/sync/items) ───────────────────────────────────────────────

/// One row in a pull page from `GET /api/sync/items`.
///
/// Tombstone rows have `payload` and `content_hash_hex` set to `None` and
/// `deleted = true`; live rows have all three set with `deleted = false`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRecord {
    /// Stable item id.
    pub id: String,
    /// Category the item belongs to.
    pub category_id: String,
    /// Plaintext payload. `None` when this row is a tombstone.
    pub payload: Option<String>,
    /// Hex-encoded SHA-256 of the plaintext payload at upload time.
    /// `None` when this row is a tombstone.
    pub content_hash_hex: Option<String>,
    /// Server-assigned version. Strictly increases per item.
    pub version: i64,
    /// `true` for tombstones, `false` for live items.
    pub deleted: bool,
    /// ISO-8601 UTC. `None` when not deleted.
    pub deleted_at_iso: Option<String>,
    /// ISO-8601 UTC of the last upsert.
    pub updated_at_iso: Option<String>,
}

/// Response body of `GET /api/sync/items`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPullPage {
    /// One page of records (server caps the page size).
    pub items: Vec<ItemRecord>,
    /// Server's max version at the time the page was assembled.
    pub server_version: i64,
    /// `true` if the caller should re-poll with an updated cursor.
    pub has_more: bool,
}

// ── status surface (privacy / settings UI) ───────────────────────────────────

/// Aggregate status for the privacy / settings UI.
///
/// Built from a [`crate::storage::cloud_sync_state::CursorState`] plus journal
/// counts via [`crate::sync::orchestrator::build_sync_status`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// Cursor (max server version this device has seen).
    pub cursor: i64,
    /// Stable per-install UUID.
    pub device_id: String,
    /// ISO-8601 of last successful full sync, `None` if never.
    pub last_full_sync_at_iso: Option<String>,
    /// Count of items in the local journal that are dirty awaiting upload.
    pub dirty_count: usize,
    /// Count of items in the local journal that are tombstones awaiting upload.
    pub pending_tombstone_count: usize,
}

// ── decision-tree inputs ─────────────────────────────────────────────────────

/// Source plaintext for one item, fed into [`crate::sync::orchestrator::decide_uploads`].
///
/// The launcher's TS layer collects these from each provider and hands them
/// to the orchestrator. `content` is the JSON of one item's data as the
/// provider emits it (sensitive fields stripped TS-side before this point).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalItemSource {
    /// Stable item id (matches the journal key).
    pub item_id: String,
    /// Category the item belongs to.
    pub category_id: String,
    /// Plaintext payload as the provider emits it.
    pub content: String,
    /// `true` when the local provider has marked this item deleted; the
    /// orchestrator emits a tombstone push.
    pub is_tombstone: bool,
}

// ── decision-tree outputs ────────────────────────────────────────────────────

/// One emitted upload action from [`crate::sync::orchestrator::decide_uploads`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadDecision {
    /// Push this live item with the computed `content_hash`.
    PushItem {
        /// Stable item id.
        item_id: String,
        /// Category the item belongs to.
        category_id: String,
        /// Plaintext payload to upload.
        plaintext: String,
        /// Raw SHA-256 of the plaintext (32 bytes).
        content_hash: [u8; 32],
    },
    /// Push a tombstone for this item.
    PushTombstone {
        /// Stable item id.
        item_id: String,
        /// Category the item belongs to.
        category_id: String,
    },
    /// Skip — local hash matches the journal's `last_uploaded_hash` and the
    /// item is not a tombstone.
    Skip {
        /// Stable item id.
        item_id: String,
    },
    /// Drop — payload exceeds [`crate::sync::orchestrator::MAX_ITEM_PAYLOAD_BYTES`];
    /// surfaces a diagnostic and does not upload. The user's launcher keeps
    /// the item locally; the cloud copy is whatever was last successfully
    /// uploaded (or absent).
    DropOversize {
        /// Stable item id.
        item_id: String,
        /// Category the item belongs to.
        category_id: String,
        /// Size of the payload in bytes.
        size_bytes: usize,
    },
}

/// One emitted download action from [`crate::sync::orchestrator::merge_pull`].
///
/// The driving consumer of `merge_pull` reads
/// [`MergeReport::lww_warnings`] for the diagnostic surface; the
/// `DownloadDecision` enum itself only emits `ApplyUpsert`, `ApplyDelete`, and
/// `Skip` actions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DownloadDecision {
    /// Apply this server record to local state via `provider.applyItemUpsert`.
    ApplyUpsert {
        /// Stable item id.
        item_id: String,
        /// Category the item belongs to.
        category_id: String,
        /// Plaintext to write locally.
        plaintext: String,
        /// Raw SHA-256 of the plaintext (32 bytes), to record on the journal.
        server_hash: [u8; 32],
        /// Server-assigned version.
        server_version: i64,
    },
    /// Apply a deletion: `provider.applyItemDelete` + journal mark.
    ApplyDelete {
        /// Stable item id.
        item_id: String,
        /// Category the item belongs to.
        category_id: String,
        /// Server-assigned version of the tombstone.
        server_version: i64,
    },
    /// Skip — server version equals what we already have AND the hashes match.
    Skip {
        /// Stable item id.
        item_id: String,
    },
}

/// Result of [`crate::sync::orchestrator::merge_pull`] — the actions to apply
/// plus a list of LWW (last-writer-wins) warnings.
///
/// The command layer turns warnings into typed `crate::diagnostics::Diagnostic`
/// reports. The list contains `item_id`s that were locally dirty when the
/// server already had a newer version; the orchestrator still emits the
/// matching `ApplyUpsert` / `ApplyDelete` action (server wins), and the
/// warning is surfaced separately so the user knows they lost a local edit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MergeReport {
    /// Actions to apply, in input order of the server page.
    pub actions: Vec<DownloadDecision>,
    /// Item ids that were overwritten by server (LWW).
    pub lww_warnings: Vec<String>,
}
