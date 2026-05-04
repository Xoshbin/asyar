//! Tauri command layer for the per-item delta cloud sync (Layer 4a, revised).
//!
//! Two commands wire the pure-function orchestrator
//! ([`crate::sync::orchestrator`]) to real I/O — HTTP via [`SyncHttp`] and the
//! local journal via [`crate::storage::cloud_sync_state`]:
//!
//! - [`sync_run`] performs a pull-then-push round-trip. The pull phase walks
//!   `GET /api/sync/items` page-by-page (advancing the cursor as it goes) and
//!   merges each page through [`crate::sync::orchestrator::merge_pull`]. The
//!   push phase reads the dirty journal, runs
//!   [`crate::sync::orchestrator::decide_uploads`] +
//!   [`crate::sync::orchestrator::chunk_for_upload`], and POSTs each chunk to
//!   `POST /api/sync/items`. On each successful chunk it clears the matching
//!   journal rows; on failure, it records the items in the report and keeps
//!   going so one bad chunk does not abort the rest of the sync.
//! - [`sync_get_status`] is purely local — it reads the cursor row + dirty
//!   journal counts and returns a [`SyncStatus`]. No HTTP round-trip is made
//!   per status check.
//!
//! The HTTP surface is abstracted as a [`SyncHttp`] trait so unit tests can
//! drive the orchestrator with a hand-rolled in-memory mock without touching
//! `reqwest` or `mockito`. [`ApiClient`] implements [`SyncHttp`] for the
//! production path.

use crate::auth::api_client::ApiClient;
use crate::auth::state::AuthState;
use crate::error::AppError;
use crate::storage::cloud_sync_state::{self, ItemJournalEntry};
use crate::storage::DataStore;
use crate::sync::orchestrator::{build_sync_status, chunk_for_upload, decide_uploads, merge_pull};
use crate::sync::types::{
    DownloadDecision, ItemPullPage, ItemPushBatchRequest, ItemPushBatchResponse, LocalItemSource,
    SyncStatus, UploadDecision,
};
use serde::{Deserialize, Serialize};
use std::future::Future;
use tauri::State;

/// Server-side cap on the pull page size. The server clamps anything higher
/// to 1000; we use 500 to keep page latency predictable.
const PULL_PAGE_LIMIT: u32 = 500;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Wire form of [`LocalItemSource`] for the Tauri command boundary.
///
/// The orchestrator's internal [`LocalItemSource`] is a pure-decision
/// intermediate that doesn't derive `Serialize`/`Deserialize`; this wire type
/// maps cleanly to the JS object the TS layer hands the Tauri invoke. We
/// translate from `LocalItemSourceWire` to `LocalItemSource` inside the
/// `sync_run_inner` helper before calling
/// [`crate::sync::orchestrator::decide_uploads`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalItemSourceWire {
    /// Stable item id (matches the journal key).
    pub item_id: String,
    /// Category the item belongs to.
    pub category_id: String,
    /// Plaintext payload as the provider emits it.
    pub content: String,
    /// `true` when the local provider has marked this item deleted.
    #[serde(default)]
    pub is_tombstone: bool,
}

impl From<LocalItemSourceWire> for LocalItemSource {
    fn from(wire: LocalItemSourceWire) -> Self {
        LocalItemSource {
            item_id: wire.item_id,
            category_id: wire.category_id,
            content: wire.content,
            is_tombstone: wire.is_tombstone,
        }
    }
}

/// Result of one [`sync_run`] pull-then-push round-trip.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRunReport {
    /// Item ids successfully pushed (live items + tombstones).
    pub uploaded: Vec<String>,
    /// Item ids skipped because the local hash already matched the journal.
    pub skipped: Vec<String>,
    /// Item ids that failed validation (oversize) or HTTP push.
    pub failed: Vec<SyncRunFailure>,
    /// Item ids applied from the server's pull (upserts + deletes).
    ///
    /// Kept alongside [`Self::applied_records`] for cheap count-only
    /// inspection from the TS layer / diagnostics; the records carry the
    /// content the providers need to update their stores.
    pub applied_from_pull: Vec<String>,
    /// Full applied records from the server's pull, in input order. The TS
    /// layer fans these out through `provider.applyItemUpsert` (live rows)
    /// or `provider.applyItemDelete` (tombstones) so each provider's local
    /// store stays in sync with the journal.
    pub applied_records: Vec<AppliedRecord>,
    /// Item ids that were locally dirty and overwritten by a newer server
    /// version — surfaced as a diagnostic warning to the user.
    pub lww_warnings: Vec<String>,
    /// New cursor value after the pull pass.
    pub server_version: i64,
}

/// One server-applied record in [`SyncRunReport::applied_records`].
///
/// `content` is the plaintext payload the server returned (the same string
/// the launcher pushed, after a round-trip). `None` indicates a tombstone
/// — the TS layer should treat the entry as a delete and call
/// `provider.applyItemDelete(item_id)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedRecord {
    /// Stable item id.
    pub item_id: String,
    /// Category the item belongs to.
    pub category_id: String,
    /// Plaintext payload (provider-emitted JSON). `None` for tombstones.
    pub content: Option<String>,
    /// `true` for tombstones, `false` for live items.
    pub deleted: bool,
}

/// One failed push entry inside a [`SyncRunReport`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRunFailure {
    /// The item id that failed.
    pub item_id: String,
    /// A short human-readable reason (typically the underlying [`AppError`]'s
    /// `Display` form, or an `oversized:` validation tag).
    pub reason: String,
}

// ── HTTP abstraction ─────────────────────────────────────────────────────────

/// HTTP surface required by the sync orchestrator.
///
/// Production code uses [`ApiClient`]; unit tests provide a hand-rolled
/// in-memory mock. We use Rust's native async-fn-in-trait (stable since
/// 1.75) instead of pulling in the `async_trait` crate.
pub trait SyncHttp {
    /// `POST /api/sync/items` — push one batch of changed items.
    fn push_items_batch(
        &self,
        token: &str,
        request: &ItemPushBatchRequest,
    ) -> impl Future<Output = Result<ItemPushBatchResponse, AppError>> + Send;

    /// `GET /api/sync/items?since=&limit=` — pull one page of records the
    /// device hasn't seen yet.
    fn pull_items_since(
        &self,
        token: &str,
        since: i64,
        limit: u32,
    ) -> impl Future<Output = Result<ItemPullPage, AppError>> + Send;
}

impl SyncHttp for ApiClient {
    fn push_items_batch(
        &self,
        token: &str,
        request: &ItemPushBatchRequest,
    ) -> impl Future<Output = Result<ItemPushBatchResponse, AppError>> + Send {
        ApiClient::push_items_batch(self, token, request)
    }

    fn pull_items_since(
        &self,
        token: &str,
        since: i64,
        limit: u32,
    ) -> impl Future<Output = Result<ItemPullPage, AppError>> + Send {
        ApiClient::pull_items_since(self, token, since, limit)
    }
}

// ── Tauri command surface ────────────────────────────────────────────────────

/// Run one delta-sync round-trip: pull all server changes since the cursor,
/// then push every dirty journal item.
///
/// `sources` is the launcher's current per-item state — one entry per item
/// the providers know about, including local deletes flagged via
/// `isTombstone`. The orchestrator merges these against the journal to
/// decide which items need to be pushed.
#[tauri::command]
pub async fn sync_run(
    sources: Vec<LocalItemSourceWire>,
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
    sync_run_inner(&sources, &token, &*api_client, &data_store).await
}

/// Read the current sync status from local state.
///
/// No HTTP round-trip — the cursor + journal are local-derivable. Returns
/// the cursor value, device id, last full sync time (ISO-8601), and counts
/// of dirty + pending-tombstone journal rows.
#[tauri::command]
pub async fn sync_get_status(data_store: State<'_, DataStore>) -> Result<SyncStatus, AppError> {
    sync_get_status_inner(&data_store).await
}

// ── _inner pure-but-async functions ──────────────────────────────────────────

/// Drive the pull-then-push round-trip against an arbitrary [`SyncHttp`].
///
/// The function is generic over `H: SyncHttp + Sync` so unit tests can pass a
/// mock implementation; the Tauri command supplies an [`ApiClient`].
///
/// On any pull-page HTTP failure the function returns the error early — a
/// pull failure means we can't safely advance the cursor and shouldn't try
/// to push (the journal might have rows that the server already has). On
/// per-chunk push failures, we record the affected items in
/// [`SyncRunReport::failed`] and continue with subsequent chunks.
pub(crate) async fn sync_run_inner<H: SyncHttp + Sync>(
    sources: &[LocalItemSourceWire],
    token: &str,
    api_client: &H,
    data_store: &DataStore,
) -> Result<SyncRunReport, AppError> {
    let mut report = SyncRunReport::default();

    // ── Pull phase ───────────────────────────────────────────────────────────
    let mut cursor = {
        let conn = data_store.conn()?;
        cloud_sync_state::get_cursor(&conn)?.cursor
    };

    loop {
        let page = api_client
            .pull_items_since(token, cursor, PULL_PAGE_LIMIT)
            .await?;

        // Snapshot the full journal once per page into a HashMap keyed by
        // item_id, so `merge_pull`'s per-server-item lookup is O(1) instead
        // of O(N). Matters at scale — a 5 000-item journal × 10 pages is the
        // difference between 50 K and 50 M comparisons.
        let merge_report = {
            let conn = data_store.conn()?;
            let map: std::collections::HashMap<String, ItemJournalEntry> =
                cloud_sync_state::get_all(&conn)?
                    .into_iter()
                    .map(|e| (e.item_id.clone(), e))
                    .collect();
            merge_pull(&page, |id| map.get(id).cloned())
        };

        // Apply each decision.
        {
            let conn = data_store.conn()?;
            for action in &merge_report.actions {
                match action {
                    DownloadDecision::ApplyUpsert {
                        item_id,
                        category_id,
                        plaintext,
                        server_hash,
                        server_version,
                    } => {
                        cloud_sync_state::apply_pull_record(
                            &conn,
                            item_id,
                            category_id,
                            Some(server_hash.as_slice()),
                            *server_version,
                            false,
                        )?;
                        report.applied_from_pull.push(item_id.clone());
                        report.applied_records.push(AppliedRecord {
                            item_id: item_id.clone(),
                            category_id: category_id.clone(),
                            content: Some(plaintext.clone()),
                            deleted: false,
                        });
                    }
                    DownloadDecision::ApplyDelete {
                        item_id,
                        category_id,
                        server_version,
                    } => {
                        cloud_sync_state::apply_pull_record(
                            &conn,
                            item_id,
                            category_id,
                            None,
                            *server_version,
                            true,
                        )?;
                        report.applied_from_pull.push(item_id.clone());
                        report.applied_records.push(AppliedRecord {
                            item_id: item_id.clone(),
                            category_id: category_id.clone(),
                            content: None,
                            deleted: true,
                        });
                    }
                    DownloadDecision::Skip { .. } => {}
                }
            }
        }

        report
            .lww_warnings
            .extend(merge_report.lww_warnings.into_iter());

        // Advance cursor after each page. We use `now_ms = 0` if the system
        // clock is unavailable; the journal's `last_full_sync_at_ms` is a UI
        // affordance, not load-bearing.
        let now_ms = current_unix_ms();
        cursor = page.server_version;
        {
            let conn = data_store.conn()?;
            cloud_sync_state::advance_cursor(&conn, cursor, now_ms)?;
        }

        if !page.has_more {
            break;
        }
    }

    // After the pull pass, hard-delete any tombstones the server has
    // confirmed — they no longer need to live in the local journal.
    {
        let conn = data_store.conn()?;
        cloud_sync_state::clear_synced_tombstones(&conn)?;
    }

    // ── Push phase ───────────────────────────────────────────────────────────
    // We need the FULL journal here, not just dirty rows: `decide_uploads`
    // hash-compares each source against its journal entry to decide
    // Skip vs PushItem. Clean items are absent from `get_dirty()`, which
    // would force the orchestrator to re-upload them on every tick.
    let (journal, device_id) = {
        let conn = data_store.conn()?;
        let all = cloud_sync_state::get_all(&conn)?;
        let device_id = cloud_sync_state::device_id(&conn)?;
        (all, device_id)
    };

    let local_sources: Vec<LocalItemSource> =
        sources.iter().cloned().map(LocalItemSource::from).collect();

    let decisions = decide_uploads(&local_sources, &journal);

    // Index decisions by item_id so we can recover the content hash after a
    // successful push (the server response just echoes ids + versions).
    let mut hash_by_id: std::collections::HashMap<String, [u8; 32]> =
        std::collections::HashMap::new();
    for d in &decisions {
        match d {
            UploadDecision::PushItem {
                item_id,
                content_hash,
                ..
            } => {
                hash_by_id.insert(item_id.clone(), *content_hash);
            }
            UploadDecision::Skip { item_id } => {
                report.skipped.push(item_id.clone());
            }
            UploadDecision::DropOversize {
                item_id,
                size_bytes,
                ..
            } => {
                report.failed.push(SyncRunFailure {
                    item_id: item_id.clone(),
                    reason: format!(
                        "oversized: {} bytes (cap {} bytes)",
                        size_bytes,
                        crate::sync::orchestrator::MAX_ITEM_PAYLOAD_BYTES
                    ),
                });
            }
            UploadDecision::PushTombstone { .. } => {}
        }
    }

    let chunks = chunk_for_upload(decisions);
    for chunk in chunks {
        let chunk_ids: Vec<String> = chunk.iter().map(|i| i.id.clone()).collect();
        // Snapshot the chunk's id → category mapping before consuming it
        // into the request — clear_dirty_after_upload needs the category
        // to insert a new journal row when one doesn't yet exist.
        let category_by_id: std::collections::HashMap<String, String> = chunk
            .iter()
            .map(|i| (i.id.clone(), i.category_id.clone()))
            .collect();
        let request = ItemPushBatchRequest {
            device_id: device_id.clone(),
            items: chunk,
        };
        match api_client.push_items_batch(token, &request).await {
            Ok(response) => {
                let conn = data_store.conn()?;
                for assignment in &response.items {
                    let hash = hash_by_id.get(&assignment.id).copied();
                    let hash_slice: Option<&[u8]> = hash.as_ref().map(|h| h.as_slice());
                    let category = category_by_id
                        .get(&assignment.id)
                        .map(String::as_str)
                        .unwrap_or("");
                    cloud_sync_state::clear_dirty_after_upload(
                        &conn,
                        &assignment.id,
                        category,
                        hash_slice,
                        assignment.version,
                    )?;
                    report.uploaded.push(assignment.id.clone());
                }
            }
            Err(e) => {
                let reason = e.to_string();
                for id in chunk_ids {
                    report.failed.push(SyncRunFailure {
                        item_id: id,
                        reason: reason.clone(),
                    });
                }
            }
        }
    }

    report.server_version = cursor;
    Ok(report)
}

/// Build a [`SyncStatus`] from local-only state.
pub(crate) async fn sync_get_status_inner(
    data_store: &DataStore,
) -> Result<SyncStatus, AppError> {
    let conn = data_store.conn()?;
    let cursor = cloud_sync_state::get_cursor(&conn)?;
    let dirty = cloud_sync_state::get_dirty(&conn)?;
    let dirty_count = dirty.len();
    let pending_tombstones = dirty.iter().filter(|e| e.is_tombstone).count();
    Ok(build_sync_status(&cursor, dirty_count, pending_tombstones))
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// Best-effort wall clock in Unix milliseconds. Returns 0 if the system
/// clock is before the epoch (effectively impossible on macOS, but the
/// type system insists). The journal's `last_full_sync_at_ms` is a UI
/// affordance, not load-bearing.
fn current_unix_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::create_test_store;
    use crate::sync::orchestrator::compute_content_hash;
    use crate::sync::types::{ItemPushAssignment, ItemRecord};
    use std::sync::Mutex;

    // ── mock SyncHttp ────────────────────────────────────────────────────────

    /// Hand-rolled in-memory mock for [`SyncHttp`].
    ///
    /// Tests pre-load the response queues; the mock pops one response per
    /// call and records the request for inspection. A test that pops past
    /// the queue will panic (assertion-style — the queue length is part of
    /// the test's contract).
    struct MockSyncHttp {
        push_responses: Mutex<Vec<Result<ItemPushBatchResponse, AppError>>>,
        pull_responses: Mutex<Vec<Result<ItemPullPage, AppError>>>,
        push_calls: Mutex<Vec<ItemPushBatchRequest>>,
        pull_calls: Mutex<Vec<(i64, u32)>>,
    }

    impl MockSyncHttp {
        fn new() -> Self {
            Self {
                push_responses: Mutex::new(Vec::new()),
                pull_responses: Mutex::new(Vec::new()),
                push_calls: Mutex::new(Vec::new()),
                pull_calls: Mutex::new(Vec::new()),
            }
        }

        fn enqueue_pull(&self, page: ItemPullPage) {
            self.pull_responses.lock().unwrap().push(Ok(page));
        }

        fn enqueue_push(&self, response: ItemPushBatchResponse) {
            self.push_responses.lock().unwrap().push(Ok(response));
        }

        fn enqueue_push_err(&self, err: AppError) {
            self.push_responses.lock().unwrap().push(Err(err));
        }

        fn push_calls(&self) -> Vec<ItemPushBatchRequest> {
            self.push_calls.lock().unwrap().clone()
        }

        fn pull_calls(&self) -> Vec<(i64, u32)> {
            self.pull_calls.lock().unwrap().clone()
        }
    }

    impl SyncHttp for MockSyncHttp {
        fn push_items_batch(
            &self,
            _token: &str,
            request: &ItemPushBatchRequest,
        ) -> impl Future<Output = Result<ItemPushBatchResponse, AppError>> + Send {
            self.push_calls.lock().unwrap().push(request.clone());
            let resp = self.push_responses.lock().unwrap().remove(0);
            async move { resp }
        }

        fn pull_items_since(
            &self,
            _token: &str,
            since: i64,
            limit: u32,
        ) -> impl Future<Output = Result<ItemPullPage, AppError>> + Send {
            self.pull_calls.lock().unwrap().push((since, limit));
            let resp = self.pull_responses.lock().unwrap().remove(0);
            async move { resp }
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    fn empty_pull_page(server_version: i64) -> ItemPullPage {
        ItemPullPage {
            items: vec![],
            server_version,
            has_more: false,
        }
    }

    fn live_record(id: &str, category: &str, payload: &str, version: i64) -> ItemRecord {
        let (_, hex) = compute_content_hash(payload.as_bytes());
        ItemRecord {
            id: id.into(),
            category_id: category.into(),
            payload: Some(payload.into()),
            content_hash_hex: Some(hex),
            version,
            deleted: false,
            deleted_at_iso: None,
            updated_at_iso: Some("2026-05-04T00:00:00.000Z".into()),
        }
    }

    fn local_wire(id: &str, category: &str, content: &str) -> LocalItemSourceWire {
        LocalItemSourceWire {
            item_id: id.into(),
            category_id: category.into(),
            content: content.into(),
            is_tombstone: false,
        }
    }

    // ── required test #1 ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn sync_run_returns_zero_when_no_dirty_and_cursor_up_to_date() {
        let http = MockSyncHttp::new();
        // One empty pull page → done.
        http.enqueue_pull(empty_pull_page(0));
        let store = create_test_store();

        let report = sync_run_inner(&[], "tok", &http, &store)
            .await
            .expect("should succeed");

        assert!(report.uploaded.is_empty());
        assert!(report.skipped.is_empty());
        assert!(report.failed.is_empty());
        assert!(report.applied_from_pull.is_empty());
        assert!(report.applied_records.is_empty());
        assert!(report.lww_warnings.is_empty());
        assert_eq!(report.server_version, 0);
        // No push call when there's nothing dirty.
        assert!(http.push_calls().is_empty(), "no push when journal empty");
        // Pull was called exactly once at since=0.
        assert_eq!(http.pull_calls(), vec![(0, PULL_PAGE_LIMIT)]);
    }

    // ── required test #2 ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn sync_run_uploads_dirty_items_in_correct_order() {
        let store = create_test_store();
        // Pre-mark two items dirty in the journal.
        {
            let conn = store.conn().unwrap();
            cloud_sync_state::mark_dirty(&conn, "alpha", "snippets").unwrap();
            cloud_sync_state::mark_dirty(&conn, "beta", "snippets").unwrap();
        }

        let http = MockSyncHttp::new();
        http.enqueue_pull(empty_pull_page(0));
        http.enqueue_push(ItemPushBatchResponse {
            items: vec![
                ItemPushAssignment {
                    id: "alpha".into(),
                    version: 11,
                },
                ItemPushAssignment {
                    id: "beta".into(),
                    version: 12,
                },
            ],
            server_version: 12,
        });

        let sources = vec![
            local_wire("alpha", "snippets", "alpha-body"),
            local_wire("beta", "snippets", "beta-body"),
        ];

        let report = sync_run_inner(&sources, "tok", &http, &store)
            .await
            .expect("ok");

        // The mock should have seen one push call carrying both items in
        // the order decide_uploads produced.
        let calls = http.push_calls();
        assert_eq!(calls.len(), 1, "single chunk for two items");
        let ids: Vec<&str> = calls[0].items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["alpha", "beta"]);
        assert_eq!(report.uploaded, vec!["alpha".to_string(), "beta".to_string()]);
        assert!(report.failed.is_empty());
    }

    // ── required test #3 ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn sync_run_pulls_then_pushes() {
        let store = create_test_store();
        {
            let conn = store.conn().unwrap();
            cloud_sync_state::mark_dirty(&conn, "local-1", "snippets").unwrap();
        }

        let http = MockSyncHttp::new();
        // Server returns one new item to apply, then we push.
        http.enqueue_pull(ItemPullPage {
            items: vec![live_record("server-1", "snippets", "from-server", 7)],
            server_version: 7,
            has_more: false,
        });
        http.enqueue_push(ItemPushBatchResponse {
            items: vec![ItemPushAssignment {
                id: "local-1".into(),
                version: 8,
            }],
            server_version: 8,
        });

        let sources = vec![local_wire("local-1", "snippets", "local-body")];
        let report = sync_run_inner(&sources, "tok", &http, &store)
            .await
            .expect("ok");

        // pull_calls precedes push_calls — the mock records in invocation
        // order, so non-empty pull_calls + push_calls together prove order.
        assert_eq!(http.pull_calls().len(), 1);
        assert_eq!(http.push_calls().len(), 1);
        assert_eq!(report.applied_from_pull, vec!["server-1".to_string()]);
        // applied_records carries the plaintext + category for the TS layer
        // to dispatch through provider.applyItemUpsert.
        assert_eq!(report.applied_records.len(), 1);
        assert_eq!(report.applied_records[0].item_id, "server-1");
        assert_eq!(report.applied_records[0].category_id, "snippets");
        assert_eq!(report.applied_records[0].content.as_deref(), Some("from-server"));
        assert!(!report.applied_records[0].deleted);
        assert_eq!(report.uploaded, vec!["local-1".to_string()]);
    }

    // ── required test #4 ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn sync_run_advances_cursor_after_successful_pull() {
        let store = create_test_store();
        let http = MockSyncHttp::new();
        // One page, no dirty items, server_version = 42.
        http.enqueue_pull(ItemPullPage {
            items: vec![],
            server_version: 42,
            has_more: false,
        });

        let report = sync_run_inner(&[], "tok", &http, &store).await.unwrap();

        assert_eq!(report.server_version, 42);
        let conn = store.conn().unwrap();
        let cursor = cloud_sync_state::get_cursor(&conn).unwrap();
        assert_eq!(cursor.cursor, 42);
    }

    #[tokio::test]
    async fn sync_run_advances_cursor_across_multiple_pages() {
        // Defensive — proves the loop walks multiple pages.
        let store = create_test_store();
        let http = MockSyncHttp::new();
        http.enqueue_pull(ItemPullPage {
            items: vec![live_record("a", "snippets", "p", 5)],
            server_version: 5,
            has_more: true,
        });
        http.enqueue_pull(ItemPullPage {
            items: vec![live_record("b", "snippets", "q", 9)],
            server_version: 9,
            has_more: false,
        });

        let report = sync_run_inner(&[], "tok", &http, &store).await.unwrap();

        assert_eq!(report.server_version, 9);
        assert_eq!(http.pull_calls(), vec![(0, PULL_PAGE_LIMIT), (5, PULL_PAGE_LIMIT)]);
        assert_eq!(report.applied_from_pull, vec!["a".to_string(), "b".to_string()]);
    }

    // ── required test #5 ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn sync_run_marks_journal_clean_after_successful_push() {
        let store = create_test_store();
        {
            let conn = store.conn().unwrap();
            cloud_sync_state::mark_dirty(&conn, "item-1", "snippets").unwrap();
        }

        let http = MockSyncHttp::new();
        http.enqueue_pull(empty_pull_page(0));
        http.enqueue_push(ItemPushBatchResponse {
            items: vec![ItemPushAssignment {
                id: "item-1".into(),
                version: 17,
            }],
            server_version: 17,
        });

        let sources = vec![local_wire("item-1", "snippets", "body")];
        sync_run_inner(&sources, "tok", &http, &store)
            .await
            .unwrap();

        let conn = store.conn().unwrap();
        let dirty = cloud_sync_state::get_dirty(&conn).unwrap();
        assert!(
            dirty.is_empty(),
            "expected journal clean after push, got {dirty:?}"
        );
    }

    #[tokio::test]
    async fn sync_run_skips_clean_items_on_second_pass() {
        // Regression: Bug A — push-phase journal lookup used to call
        // `get_dirty()`, so clean items were absent from the orchestrator's
        // map and forced through PushItem on every tick (the user's DB
        // showed 1003 clipboard rows at version 8000). After the fix
        // (`get_all` + UPSERT in clear_dirty_after_upload), the second
        // sync of unchanged sources must produce zero pushes.
        let store = create_test_store();
        let sources = vec![
            local_wire("item-1", "clipboard", "alpha"),
            local_wire("item-2", "clipboard", "beta"),
        ];

        // First pass: nothing in journal, both items push.
        let http1 = MockSyncHttp::new();
        http1.enqueue_pull(empty_pull_page(0));
        http1.enqueue_push(ItemPushBatchResponse {
            items: vec![
                ItemPushAssignment { id: "item-1".into(), version: 1 },
                ItemPushAssignment { id: "item-2".into(), version: 2 },
            ],
            server_version: 2,
        });
        let report1 = sync_run_inner(&sources, "tok", &http1, &store)
            .await
            .unwrap();
        assert_eq!(report1.uploaded.len(), 2, "first pass should upload both");

        // Second pass: same sources, no changes. Hash matches journal,
        // both items must Skip — zero push HTTP calls expected.
        let http2 = MockSyncHttp::new();
        http2.enqueue_pull(empty_pull_page(2));
        // Deliberately do NOT enqueue a push response; if the orchestrator
        // tries to push, the mock will panic on drain-past-end.
        let report2 = sync_run_inner(&sources, "tok", &http2, &store)
            .await
            .unwrap();
        assert_eq!(report2.uploaded.len(), 0, "second pass must not re-upload");
        assert_eq!(report2.skipped.len(), 2, "both items should be skipped");
    }

    #[tokio::test]
    async fn sync_run_keeps_failed_items_dirty() {
        // Defensive — push HTTP error must NOT clear the journal entry,
        // and must surface in `failed`.
        let store = create_test_store();
        {
            let conn = store.conn().unwrap();
            cloud_sync_state::mark_dirty(&conn, "item-1", "snippets").unwrap();
        }

        let http = MockSyncHttp::new();
        http.enqueue_pull(empty_pull_page(0));
        http.enqueue_push_err(AppError::Auth("token expired".into()));

        let sources = vec![local_wire("item-1", "snippets", "body")];
        let report = sync_run_inner(&sources, "tok", &http, &store)
            .await
            .unwrap();

        assert!(report.uploaded.is_empty());
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].item_id, "item-1");
        assert!(report.failed[0].reason.contains("token expired"));

        let conn = store.conn().unwrap();
        let dirty = cloud_sync_state::get_dirty(&conn).unwrap();
        assert_eq!(dirty.len(), 1, "failed push must leave row dirty");
    }

    // ── required test #6 ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn sync_run_surfaces_lww_warning_via_diagnostics() {
        let store = create_test_store();
        // Set up a dirty local entry that the server is about to overwrite.
        {
            let conn = store.conn().unwrap();
            cloud_sync_state::upsert_item(
                &conn,
                &ItemJournalEntry {
                    item_id: "conflict-1".into(),
                    category_id: "snippets".into(),
                    last_uploaded_hash: Some(vec![0xAAu8; 32]),
                    server_version: Some(2),
                    is_dirty: true,
                    is_tombstone: false,
                },
            )
            .unwrap();
        }

        let http = MockSyncHttp::new();
        // Server has a newer version of conflict-1; merge_pull will emit an
        // ApplyUpsert AND surface conflict-1 in lww_warnings because the
        // journal entry was dirty.
        http.enqueue_pull(ItemPullPage {
            items: vec![live_record("conflict-1", "snippets", "server-wins", 5)],
            server_version: 5,
            has_more: false,
        });
        // After the pull phase apply_pull_record clears is_dirty for
        // conflict-1, so the push phase sees no dirty rows. We pass empty
        // sources to keep the test focused on the LWW propagation path:
        // decide_uploads against an empty input emits zero decisions, so
        // no push HTTP call is made.
        let report = sync_run_inner(&[], "tok", &http, &store).await.unwrap();

        assert_eq!(
            report.lww_warnings,
            vec!["conflict-1".to_string()],
            "lww warning must propagate from MergeReport"
        );
        // No pushes happened.
        assert!(http.push_calls().is_empty());
    }

    // ── required test #7 ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn sync_get_status_returns_last_sync_time_and_cursor() {
        let store = create_test_store();
        // Seed a non-trivial cursor + a dirty + a tombstone.
        {
            let conn = store.conn().unwrap();
            cloud_sync_state::advance_cursor(&conn, 99, 1_777_856_523_456).unwrap();
            cloud_sync_state::mark_dirty(&conn, "live-1", "snippets").unwrap();
            cloud_sync_state::mark_tombstone(&conn, "dead-1", "snippets").unwrap();
        }

        let status = sync_get_status_inner(&store).await.unwrap();

        assert_eq!(status.cursor, 99);
        assert!(!status.device_id.is_empty(), "device_id must be seeded");
        assert!(
            status.last_full_sync_at_iso.is_some(),
            "advance_cursor wrote a timestamp"
        );
        // Both rows are dirty.
        assert_eq!(status.dirty_count, 2);
        // Only the tombstone counts toward pending_tombstone_count.
        assert_eq!(status.pending_tombstone_count, 1);
    }

    // ── extra coverage ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn sync_run_pushes_journal_only_tombstones() {
        // A tombstone in the journal that the providers don't surface should
        // still be uploaded (orchestrator's "trailing tombstones" path).
        let store = create_test_store();
        {
            let conn = store.conn().unwrap();
            cloud_sync_state::mark_tombstone(&conn, "ghost", "snippets").unwrap();
        }

        let http = MockSyncHttp::new();
        http.enqueue_pull(empty_pull_page(0));
        http.enqueue_push(ItemPushBatchResponse {
            items: vec![ItemPushAssignment {
                id: "ghost".into(),
                version: 21,
            }],
            server_version: 21,
        });

        let report = sync_run_inner(&[], "tok", &http, &store).await.unwrap();
        assert_eq!(report.uploaded, vec!["ghost".to_string()]);

        // After upload + clear_synced_tombstones is run on the NEXT pull,
        // but on the same run the row is still present (tombstones are
        // cleared at the END of pull, before push). After push completes
        // the row is { is_tombstone=1, server_version=Some, is_dirty=0 }.
        // Run a follow-up empty sync to trigger clear_synced_tombstones.
        let http2 = MockSyncHttp::new();
        http2.enqueue_pull(empty_pull_page(21));
        sync_run_inner(&[], "tok", &http2, &store).await.unwrap();

        // Now the row should be gone.
        let conn = store.conn().unwrap();
        let all = cloud_sync_state::get_all(&conn).unwrap();
        assert!(
            all.iter().all(|e| e.item_id != "ghost"),
            "tombstone should have been cleared on the second pull"
        );
    }

    #[tokio::test]
    async fn local_item_source_wire_round_trip_serde() {
        let wire = LocalItemSourceWire {
            item_id: "i".into(),
            category_id: "snippets".into(),
            content: "{}".into(),
            is_tombstone: true,
        };
        let json = serde_json::to_string(&wire).unwrap();
        assert!(json.contains("\"itemId\":\"i\""));
        assert!(json.contains("\"categoryId\":\"snippets\""));
        assert!(json.contains("\"isTombstone\":true"));

        let back: LocalItemSourceWire = serde_json::from_str(&json).unwrap();
        assert_eq!(back.item_id, "i");
        assert_eq!(back.category_id, "snippets");
        assert!(back.is_tombstone);
    }

    #[test]
    fn sync_run_report_serializes_with_camel_case() {
        let r = SyncRunReport {
            uploaded: vec!["i1".into()],
            skipped: vec!["i2".into()],
            failed: vec![SyncRunFailure {
                item_id: "i3".into(),
                reason: "oversized".into(),
            }],
            applied_from_pull: vec!["i4".into()],
            applied_records: vec![AppliedRecord {
                item_id: "i4".into(),
                category_id: "snippets".into(),
                content: Some("{}".into()),
                deleted: false,
            }],
            lww_warnings: vec!["i5".into()],
            server_version: 7,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"uploaded\":[\"i1\"]"));
        assert!(json.contains("\"appliedFromPull\":[\"i4\"]"));
        assert!(json.contains("\"appliedRecords\""));
        assert!(json.contains("\"lwwWarnings\":[\"i5\"]"));
        assert!(json.contains("\"serverVersion\":7"));
        assert!(json.contains("\"itemId\":\"i3\""));
    }

    #[tokio::test]
    async fn sync_run_emits_applied_records_for_upserts_and_deletes() {
        // Server returns one live row + one tombstone; the TS layer must be
        // able to fan out both through provider methods, so applied_records
        // must carry plaintext for the live one and `deleted=true` for the
        // tombstone.
        let store = create_test_store();
        let http = MockSyncHttp::new();
        let tombstone = ItemRecord {
            id: "ghost".into(),
            category_id: "snippets".into(),
            payload: None,
            content_hash_hex: None,
            version: 4,
            deleted: true,
            deleted_at_iso: Some("2026-05-04T00:00:00.000Z".into()),
            updated_at_iso: Some("2026-05-04T00:00:00.000Z".into()),
        };
        http.enqueue_pull(ItemPullPage {
            items: vec![live_record("a", "snippets", "alpha", 3), tombstone],
            server_version: 4,
            has_more: false,
        });

        let report = sync_run_inner(&[], "tok", &http, &store).await.unwrap();

        // Order matches the server page order.
        assert_eq!(report.applied_records.len(), 2);
        assert_eq!(report.applied_records[0].item_id, "a");
        assert_eq!(report.applied_records[0].content.as_deref(), Some("alpha"));
        assert!(!report.applied_records[0].deleted);
        assert_eq!(report.applied_records[1].item_id, "ghost");
        assert!(report.applied_records[1].content.is_none());
        assert!(report.applied_records[1].deleted);
        // applied_from_pull is the cheap-id-only mirror.
        assert_eq!(
            report.applied_from_pull,
            vec!["a".to_string(), "ghost".to_string()]
        );
    }
}
