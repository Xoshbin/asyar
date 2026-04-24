//! Launcher-brokered durable state store + RPC primitive for Tier 2 extensions.
//!
//! The view context reads + subscribes; the worker context writes; both
//! share the same `(extension_id, key) -> JSON` namespace. State survives
//! launcher restart because the SQLite write happens in `set`. RPC calls
//! flow view → worker via the runtime's mailbox; replies flow worker → view
//! via a Tauri broadcast event matched by `correlationId` in the view-side
//! SDK.
//!
//! Persistence lives in [`crate::storage::extension_state`]; this module
//! owns the in-memory subscription registry and the event-emission glue.
//! Subscription filtering and fan-out are Rust-side per the rust-first
//! skill — the SDK proxy receives only events it asked for.

use crate::error::AppError;
use crate::extensions::extension_runtime::types::ContextRole;
use crate::storage::extension_state as store;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub type SubscriptionId = u64;

/// One row in the in-memory subscription registry. The launcher fans out
/// `state:changed` to the matching `(extension_id, key, role)` subscribers
/// only — never globally — so the SDK proxy on the receiving side does not
/// have to filter.
#[derive(Debug, Clone)]
pub struct Subscription {
    pub extension_id: String,
    pub key: String,
    pub role: ContextRole,
    /// Wall clock at `subscribe()` time, milliseconds since Unix epoch.
    /// Consumed by the dev inspector for "installed" timestamps; not
    /// load-bearing for fan-out.
    pub installed_at: u64,
}

/// One row returned by `list_all` — the SQLite shape plus `updated_at` so
/// the dev inspector can render "last changed" timestamps.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StateEntry {
    pub key: String,
    pub value: Value,
    pub updated_at: u64,
}

/// Aggregated summary returned by `list_subscriptions` — one row per
/// `(key, role)` with a count of subscribers and the earliest install
/// timestamp. Subscribers are deduped to `(key, role)` because multiple
/// subscriptions on the same tuple only produce one broadcast per role.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionSummary {
    pub key: String,
    pub role: ContextRole,
    pub installed_at: u64,
    pub listener_count: usize,
}

/// Wire shape for the `state:changed` push delivered to one iframe.
/// Includes `role` so the frontend push bridge can target the correct iframe
/// (`iframe[data-extension-id="..."][data-role="worker|view"]`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StateChangedPayload {
    pub extension_id: String,
    pub key: String,
    pub value: Value,
    pub role: ContextRole,
}

/// Wire shape for the worker → view RPC reply broadcast. The view-side
/// SDK matches on `correlation_id`; replies for unknown correlation ids are
/// dropped silently.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RpcReplyPayload {
    pub extension_id: String,
    pub correlation_id: String,
    /// Present on success.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// Present on failure (handler threw or returned a rejected promise).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Pluggable emission seam. Production wires this to a Tauri `AppHandle`
/// via [`TauriStateEmitter`]; tests substitute [`RecordingStateEmitter`] to
/// assert exactly what would have been broadcast.
pub trait StateEventEmitter: Send + Sync {
    fn emit_state_changed(&self, payload: &StateChangedPayload);
    fn emit_rpc_reply(&self, payload: &RpcReplyPayload);
}

pub struct ExtensionStateService {
    data_store: Arc<Mutex<Connection>>,
    subscriptions: Mutex<HashMap<SubscriptionId, Subscription>>,
    next_id: AtomicU64,
    emitter: Mutex<Option<Box<dyn StateEventEmitter>>>,
}

impl ExtensionStateService {
    pub fn new(data_store: Arc<Mutex<Connection>>) -> Self {
        Self {
            data_store,
            subscriptions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            emitter: Mutex::new(None),
        }
    }

    /// Install the broadcast emitter. Production wiring happens in
    /// `setup_app` once the `AppHandle` is available; tests can replace it
    /// in-line.
    pub fn set_emitter(&self, emitter: Box<dyn StateEventEmitter>) {
        *self.emitter.lock().expect("state emitter mutex poisoned") = Some(emitter);
    }

    pub fn get(&self, extension_id: &str, key: &str) -> Result<Option<Value>, AppError> {
        let conn = self.data_store.lock().map_err(|_| AppError::Lock)?;
        store::get(&conn, extension_id, key)
    }

    /// Persist `(extension_id, key) = value` and broadcast `state:changed`
    /// to every distinct role that has at least one subscription on the
    /// pair. The dedup keeps push traffic minimal: a single `set` that
    /// matches ten worker-side subscribers fires one event, and the SDK
    /// proxy demultiplexes to each registered handler in-process.
    pub fn set(
        &self,
        extension_id: &str,
        key: &str,
        value: Value,
        now_ms: u64,
    ) -> Result<(), AppError> {
        {
            let conn = self.data_store.lock().map_err(|_| AppError::Lock)?;
            store::set(&conn, extension_id, key, &value, now_ms)?;
        }

        let target_roles: Vec<ContextRole> = {
            let subs = self.subscriptions.lock().expect("subscriptions mutex poisoned");
            let mut roles: HashSet<ContextRole> = HashSet::new();
            for s in subs.values() {
                if s.extension_id == extension_id && s.key == key {
                    roles.insert(s.role);
                }
            }
            roles.into_iter().collect()
        };

        if target_roles.is_empty() {
            return Ok(());
        }

        let emitter_guard = self.emitter.lock().expect("state emitter mutex poisoned");
        if let Some(emitter) = emitter_guard.as_ref() {
            for role in target_roles {
                emitter.emit_state_changed(&StateChangedPayload {
                    extension_id: extension_id.to_string(),
                    key: key.to_string(),
                    value: value.clone(),
                    role,
                });
            }
        }

        Ok(())
    }

    pub fn subscribe(
        &self,
        extension_id: String,
        key: String,
        role: ContextRole,
        now_ms: u64,
    ) -> SubscriptionId {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut subs = self.subscriptions.lock().expect("subscriptions mutex poisoned");
        subs.insert(
            id,
            Subscription {
                extension_id,
                key,
                role,
                installed_at: now_ms,
            },
        );
        id
    }

    /// Read every persisted `(key, value, updated_at)` row for
    /// `extension_id`. Used by the dev inspector's State panel — production
    /// code paths never enumerate keys, they read one at a time. Returns
    /// rows in arbitrary order; callers sort as needed.
    pub fn list_all(&self, extension_id: &str) -> Result<Vec<StateEntry>, AppError> {
        let conn = self.data_store.lock().map_err(|_| AppError::Lock)?;
        store::get_all(&conn, extension_id)
    }

    /// Group the in-memory subscription registry into one row per
    /// `(key, role)` for `extension_id`. `listener_count` is the number of
    /// distinct subscription ids collapsed into the group; `installed_at`
    /// is the minimum across the group so the UI shows "first seen".
    pub fn list_subscriptions(&self, extension_id: &str) -> Vec<SubscriptionSummary> {
        let subs = self.subscriptions.lock().expect("subscriptions mutex poisoned");
        let mut by_group: HashMap<(String, ContextRole), (u64, usize)> = HashMap::new();
        for s in subs.values() {
            if s.extension_id != extension_id {
                continue;
            }
            let entry = by_group.entry((s.key.clone(), s.role)).or_insert((s.installed_at, 0));
            entry.0 = entry.0.min(s.installed_at);
            entry.1 += 1;
        }
        by_group
            .into_iter()
            .map(|((key, role), (installed_at, listener_count))| SubscriptionSummary {
                key,
                role,
                installed_at,
                listener_count,
            })
            .collect()
    }

    pub fn unsubscribe(&self, id: SubscriptionId) -> Result<(), AppError> {
        let mut subs = self.subscriptions.lock().expect("subscriptions mutex poisoned");
        subs.remove(&id);
        // Returning Ok even if the id was unknown matches the SDK contract:
        // unsubscribe is idempotent so view-side `pagehide` cleanup never
        // surfaces "no such subscription" errors when a subscription was
        // already torn down by the launcher (e.g. during uninstall).
        Ok(())
    }

    /// Delete every persisted row for `extension_id` and drop every active
    /// subscription owned by that extension. Called by `lifecycle::uninstall`
    /// after the runtime's `notify_extension_removed` synchronously tears
    /// down both context machines (see Phase 5 §4d).
    pub fn clear(&self, extension_id: &str) -> Result<u64, AppError> {
        let row_count = {
            let conn = self.data_store.lock().map_err(|_| AppError::Lock)?;
            store::clear(&conn, extension_id)?
        };
        let mut subs = self.subscriptions.lock().expect("subscriptions mutex poisoned");
        subs.retain(|_, s| s.extension_id != extension_id);
        Ok(row_count)
    }

    /// Relay a worker → view RPC reply. The Tauri command handler delegates
    /// here so tests can assert routing without a live `AppHandle`.
    pub fn relay_rpc_reply(&self, payload: RpcReplyPayload) {
        let emitter_guard = self.emitter.lock().expect("state emitter mutex poisoned");
        if let Some(emitter) = emitter_guard.as_ref() {
            emitter.emit_rpc_reply(&payload);
        }
    }

    #[cfg(test)]
    fn subscription_count(&self) -> usize {
        self.subscriptions.lock().unwrap().len()
    }
}

/// Tauri-backed emitter. One instance per service registration.
pub struct TauriStateEmitter {
    pub app: tauri::AppHandle,
}

impl StateEventEmitter for TauriStateEmitter {
    fn emit_state_changed(&self, payload: &StateChangedPayload) {
        use tauri::Emitter;
        if let Err(e) = self.app.emit("asyar:state-changed", payload) {
            log::warn!("[extension_state] emit state-changed failed: {e}");
        }
    }

    fn emit_rpc_reply(&self, payload: &RpcReplyPayload) {
        use tauri::Emitter;
        if let Err(e) = self.app.emit("asyar:state-rpc-reply", payload) {
            log::warn!("[extension_state] emit rpc-reply failed: {e}");
        }
    }
}

/// Test double — captures emissions in order so tests can assert exactly
/// what would have flowed onto the Tauri event channel.
#[derive(Default)]
pub struct RecordingStateEmitter {
    pub state_changed: Mutex<Vec<StateChangedPayload>>,
    pub rpc_replies: Mutex<Vec<RpcReplyPayload>>,
}

impl RecordingStateEmitter {
    pub fn changed(&self) -> Vec<StateChangedPayload> {
        self.state_changed.lock().unwrap().clone()
    }
    pub fn replies(&self) -> Vec<RpcReplyPayload> {
        self.rpc_replies.lock().unwrap().clone()
    }
}

impl StateEventEmitter for RecordingStateEmitter {
    fn emit_state_changed(&self, payload: &StateChangedPayload) {
        self.state_changed.lock().unwrap().push(payload.clone());
    }
    fn emit_rpc_reply(&self, payload: &RpcReplyPayload) {
        self.rpc_replies.lock().unwrap().push(payload.clone());
    }
}

impl<T: StateEventEmitter + ?Sized> StateEventEmitter for Arc<T> {
    fn emit_state_changed(&self, payload: &StateChangedPayload) {
        (**self).emit_state_changed(payload);
    }
    fn emit_rpc_reply(&self, payload: &RpcReplyPayload) {
        (**self).emit_rpc_reply(payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::extension_state as store;
    use rusqlite::Connection;

    fn fresh_conn() -> Arc<Mutex<Connection>> {
        let conn = Connection::open_in_memory().unwrap();
        store::init_table(&conn).unwrap();
        Arc::new(Mutex::new(conn))
    }

    fn svc_with_emitter() -> (ExtensionStateService, Arc<RecordingStateEmitter>) {
        let svc = ExtensionStateService::new(fresh_conn());
        let emitter: Arc<RecordingStateEmitter> = Arc::new(RecordingStateEmitter::default());
        svc.set_emitter(Box::new(Arc::clone(&emitter)));
        (svc, emitter)
    }

    // ── Persistence ────────────────────────────────────────────────────────

    #[test]
    fn get_returns_none_for_unseen_key() {
        let (svc, _) = svc_with_emitter();
        assert!(svc.get("ext.a", "missing").unwrap().is_none());
    }

    #[test]
    fn set_then_get_round_trips() {
        let (svc, _) = svc_with_emitter();
        svc.set("ext.a", "k", serde_json::json!({ "x": 1 }), 0).unwrap();
        assert_eq!(
            svc.get("ext.a", "k").unwrap(),
            Some(serde_json::json!({ "x": 1 }))
        );
    }

    #[test]
    fn set_persists_across_service_restart() {
        // Mirrors "running the launcher twice" — the underlying SQLite
        // connection is shared, the service instance is recreated.
        let conn = fresh_conn();
        let svc1 = ExtensionStateService::new(Arc::clone(&conn));
        svc1.set("ext.a", "timer", serde_json::json!({ "running": true }), 0).unwrap();

        // Drop & recreate the service against the same DB.
        drop(svc1);
        let svc2 = ExtensionStateService::new(Arc::clone(&conn));
        assert_eq!(
            svc2.get("ext.a", "timer").unwrap(),
            Some(serde_json::json!({ "running": true })),
            "value must survive service restart against the same DB",
        );
    }

    #[test]
    fn clear_deletes_all_keys_for_one_extension_only() {
        let (svc, _) = svc_with_emitter();
        svc.set("ext.a", "k1", serde_json::json!(1), 0).unwrap();
        svc.set("ext.a", "k2", serde_json::json!(2), 0).unwrap();
        svc.set("ext.b", "k1", serde_json::json!("safe"), 0).unwrap();

        let removed = svc.clear("ext.a").unwrap();
        assert_eq!(removed, 2);
        assert!(svc.get("ext.a", "k1").unwrap().is_none());
        assert!(svc.get("ext.a", "k2").unwrap().is_none());
        assert_eq!(
            svc.get("ext.b", "k1").unwrap(),
            Some(serde_json::json!("safe"))
        );
    }

    // ── Subscriptions & fan-out ────────────────────────────────────────────

    #[test]
    fn subscribe_returns_unique_ids() {
        let (svc, _) = svc_with_emitter();
        let id1 = svc.subscribe("ext.a".into(), "k".into(), ContextRole::View, 0);
        let id2 = svc.subscribe("ext.a".into(), "k".into(), ContextRole::View, 0);
        assert_ne!(id1, id2, "subscription ids must be unique even for identical (ext, key, role)");
    }

    #[test]
    fn set_fires_state_changed_to_matching_subscriber() {
        let (svc, emitter) = svc_with_emitter();
        let _id = svc.subscribe("ext.a".into(), "timer".into(), ContextRole::View, 0);
        svc.set("ext.a", "timer", serde_json::json!({ "secs": 1 }), 0)
            .unwrap();
        let events = emitter.changed();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].extension_id, "ext.a");
        assert_eq!(events[0].key, "timer");
        assert_eq!(events[0].role, ContextRole::View);
        assert_eq!(events[0].value, serde_json::json!({ "secs": 1 }));
    }

    #[test]
    fn set_does_not_fire_to_subscribers_of_different_key() {
        let (svc, emitter) = svc_with_emitter();
        svc.subscribe("ext.a".into(), "other".into(), ContextRole::View, 0);
        svc.set("ext.a", "timer", serde_json::json!(1), 0).unwrap();
        assert!(emitter.changed().is_empty(), "different key must not fire");
    }

    #[test]
    fn set_does_not_fire_to_subscribers_of_different_extension() {
        let (svc, emitter) = svc_with_emitter();
        svc.subscribe("ext.b".into(), "timer".into(), ContextRole::View, 0);
        svc.set("ext.a", "timer", serde_json::json!(1), 0).unwrap();
        assert!(
            emitter.changed().is_empty(),
            "subscriber on a different extension must not fire"
        );
    }

    #[test]
    fn set_emits_once_per_distinct_role_even_with_multiple_subscriptions() {
        // Two view subscribers + one worker subscriber on the same (ext,
        // key) → one push to view, one push to worker. The SDK proxy
        // demultiplexes within the iframe.
        let (svc, emitter) = svc_with_emitter();
        svc.subscribe("ext.a".into(), "timer".into(), ContextRole::View, 0);
        svc.subscribe("ext.a".into(), "timer".into(), ContextRole::View, 0);
        svc.subscribe("ext.a".into(), "timer".into(), ContextRole::Worker, 0);

        svc.set("ext.a", "timer", serde_json::json!({ "secs": 5 }), 0)
            .unwrap();
        let events = emitter.changed();
        assert_eq!(events.len(), 2, "one event per distinct role");

        let roles: HashSet<ContextRole> = events.iter().map(|e| e.role).collect();
        assert!(roles.contains(&ContextRole::View));
        assert!(roles.contains(&ContextRole::Worker));
    }

    #[test]
    fn set_with_no_subscribers_emits_nothing() {
        let (svc, emitter) = svc_with_emitter();
        svc.set("ext.a", "k", serde_json::json!(1), 0).unwrap();
        assert!(emitter.changed().is_empty(), "no subscribers, no broadcast");
        // But the value IS persisted.
        assert_eq!(svc.get("ext.a", "k").unwrap(), Some(serde_json::json!(1)));
    }

    #[test]
    fn unsubscribe_stops_future_state_changed() {
        let (svc, emitter) = svc_with_emitter();
        let id = svc.subscribe("ext.a".into(), "k".into(), ContextRole::View, 0);
        svc.set("ext.a", "k", serde_json::json!(1), 0).unwrap();
        svc.unsubscribe(id).unwrap();
        svc.set("ext.a", "k", serde_json::json!(2), 0).unwrap();

        let events = emitter.changed();
        assert_eq!(events.len(), 1, "second set must not fire after unsubscribe");
        assert_eq!(events[0].value, serde_json::json!(1));
    }

    #[test]
    fn unsubscribe_unknown_id_is_idempotent() {
        let (svc, _) = svc_with_emitter();
        // No subscription was ever issued — unsubscribe of a fabricated id
        // is a noop, not an error. View-side pagehide cleanup hits this
        // path when the launcher cleared subs first (uninstall race).
        svc.unsubscribe(9999).unwrap();
    }

    #[test]
    fn clear_drops_subscriptions_for_the_extension() {
        let (svc, emitter) = svc_with_emitter();
        svc.subscribe("ext.a".into(), "k".into(), ContextRole::View, 0);
        svc.subscribe("ext.b".into(), "k".into(), ContextRole::View, 0);
        assert_eq!(svc.subscription_count(), 2);

        svc.clear("ext.a").unwrap();
        assert_eq!(svc.subscription_count(), 1, "ext.a subscription must be dropped");

        // Subsequent set on ext.a does not fire.
        svc.set("ext.a", "k", serde_json::json!(1), 0).unwrap();
        assert!(emitter.changed().is_empty());

        // ext.b still receives.
        svc.set("ext.b", "k", serde_json::json!(2), 0).unwrap();
        assert_eq!(emitter.changed().len(), 1);
    }

    // ── RPC reply relay ────────────────────────────────────────────────────

    #[test]
    fn relay_rpc_reply_emits_through_emitter() {
        let (svc, emitter) = svc_with_emitter();
        svc.relay_rpc_reply(RpcReplyPayload {
            extension_id: "ext.a".into(),
            correlation_id: "abc-123".into(),
            result: Some(serde_json::json!({ "ok": true })),
            error: None,
        });
        let replies = emitter.replies();
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0].correlation_id, "abc-123");
        assert_eq!(replies[0].result, Some(serde_json::json!({ "ok": true })));
        assert!(replies[0].error.is_none());
    }

    #[test]
    fn relay_rpc_reply_with_error_emits_error_field() {
        let (svc, emitter) = svc_with_emitter();
        svc.relay_rpc_reply(RpcReplyPayload {
            extension_id: "ext.a".into(),
            correlation_id: "abc-123".into(),
            result: None,
            error: Some("handler threw".into()),
        });
        let replies = emitter.replies();
        assert_eq!(replies[0].error.as_deref(), Some("handler threw"));
    }

    #[test]
    fn rpc_reply_payload_serializes_result_omits_error_when_absent() {
        // Wire shape contract — view-side SDK matches reply on
        // `correlationId`; presence/absence of `error` decides resolve vs
        // reject. `serde(skip_serializing_if = "Option::is_none")` keeps
        // the JSON shape clean.
        let p = RpcReplyPayload {
            extension_id: "ext.a".into(),
            correlation_id: "c1".into(),
            result: Some(serde_json::json!({ "v": 1 })),
            error: None,
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["correlationId"], "c1");
        assert_eq!(json["result"], serde_json::json!({ "v": 1 }));
        assert!(json.get("error").is_none(), "absent error must not appear in JSON");
    }

    #[test]
    fn state_changed_payload_serializes_role_as_camel_case() {
        let p = StateChangedPayload {
            extension_id: "ext.a".into(),
            key: "k".into(),
            value: serde_json::json!(1),
            role: ContextRole::Worker,
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["role"], "worker");
        assert_eq!(json["extensionId"], "ext.a");
    }

    // ── Uninstall ordering: state:clear runs after teardown ────────────────

    #[test]
    fn clear_after_runtime_teardown_drops_state_and_subs_in_one_step() {
        // Mirrors the lifecycle::uninstall sequence: the runtime's
        // `notify_extension_removed` runs first (synchronously tears down
        // both context machines), then `extension_state::clear` runs. After
        // both, no rows survive and no subscriptions remain.
        use crate::extensions::extension_runtime::{ExtensionRuntimeManager, RuntimeConfig};

        let mgr = ExtensionRuntimeManager::new(RuntimeConfig::default());
        let (svc, emitter) = svc_with_emitter();

        // Seed: extension has state and subscriptions.
        svc.subscribe("ext.a".into(), "timer".into(), ContextRole::View, 0);
        svc.subscribe("ext.a".into(), "timer".into(), ContextRole::Worker, 0);
        svc.set("ext.a", "timer", serde_json::json!({ "secs": 7 }), 0)
            .unwrap();
        // Sanity: the seed `set` fanned out to both roles.
        assert_eq!(emitter.changed().len(), 2, "seed set fans out to both roles");
        emitter.state_changed.lock().unwrap().clear();

        // Step 1 — runtime teardown of both contexts. Synchronous; no acks.
        let (worker_had, view_had) = mgr.tear_down_both("ext.a");
        // No state machines were seeded in this test, so `had` is false —
        // the teardown is still a noop precondition that must not panic.
        assert!(!worker_had && !view_had);

        // Step 2 — state:clear. Drops rows AND subscriptions.
        let removed = svc.clear("ext.a").unwrap();
        assert_eq!(removed, 1, "one row deleted");
        assert!(svc.get("ext.a", "timer").unwrap().is_none());
        assert_eq!(svc.subscription_count(), 0, "subs dropped on clear");

        // Step 3 — a late `set` from a "dying" worker would no-op for
        // fan-out (no subs left) and still write the row only because the
        // store layer doesn't gate on registry membership. The IpcRouter
        // gates on registry membership before reaching this service, so a
        // real late call is rejected upstream — assert the local invariant
        // that fan-out doesn't fire after clear.
        svc.set("ext.a", "timer", serde_json::json!({ "secs": 99 }), 0)
            .unwrap();
        assert!(
            emitter.changed().is_empty(),
            "no subscribers after clear → no fan-out"
        );
    }

    // ── Dev inspector introspection ────────────────────────────────────────

    #[test]
    fn subscribe_records_installed_at_timestamp_on_the_subscription() {
        let (svc, _) = svc_with_emitter();
        svc.subscribe("ext.a".into(), "k".into(), ContextRole::View, 1_700_000_000_000);
        let subs = svc.subscriptions.lock().unwrap();
        let sub = subs.values().next().unwrap();
        assert_eq!(sub.installed_at, 1_700_000_000_000);
    }

    #[test]
    fn list_all_returns_every_key_for_the_extension() {
        let (svc, _) = svc_with_emitter();
        svc.set("ext.a", "k1", serde_json::json!(1), 100).unwrap();
        svc.set("ext.a", "k2", serde_json::json!("two"), 200).unwrap();
        svc.set("ext.b", "k1", serde_json::json!("other"), 300).unwrap();

        let mut rows = svc.list_all("ext.a").unwrap();
        rows.sort_by(|a, b| a.key.cmp(&b.key));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].key, "k1");
        assert_eq!(rows[0].value, serde_json::json!(1));
        assert_eq!(rows[0].updated_at, 100);
        assert_eq!(rows[1].key, "k2");
        assert_eq!(rows[1].value, serde_json::json!("two"));
        assert_eq!(rows[1].updated_at, 200);
    }

    #[test]
    fn list_all_returns_empty_for_unknown_extension() {
        let (svc, _) = svc_with_emitter();
        assert!(svc.list_all("ext.missing").unwrap().is_empty());
    }

    #[test]
    fn list_subscriptions_groups_by_key_and_role_with_counts() {
        // Three view subscribers + one worker subscriber on the same key
        // collapse to two rows: (k, view, count=3) + (k, worker, count=1).
        let (svc, _) = svc_with_emitter();
        svc.subscribe("ext.a".into(), "k".into(), ContextRole::View, 100);
        svc.subscribe("ext.a".into(), "k".into(), ContextRole::View, 200);
        svc.subscribe("ext.a".into(), "k".into(), ContextRole::View, 300);
        svc.subscribe("ext.a".into(), "k".into(), ContextRole::Worker, 400);
        // Noise: different extension, must be filtered out.
        svc.subscribe("ext.b".into(), "k".into(), ContextRole::View, 500);

        let rows = svc.list_subscriptions("ext.a");
        assert_eq!(rows.len(), 2);
        let view_row = rows.iter().find(|r| r.role == ContextRole::View).unwrap();
        let worker_row = rows.iter().find(|r| r.role == ContextRole::Worker).unwrap();
        assert_eq!(view_row.listener_count, 3);
        assert_eq!(view_row.installed_at, 100, "earliest of the three view subs");
        assert_eq!(worker_row.listener_count, 1);
        assert_eq!(worker_row.installed_at, 400);
    }

    #[test]
    fn list_subscriptions_returns_empty_for_extension_with_no_subs() {
        let (svc, _) = svc_with_emitter();
        svc.subscribe("ext.a".into(), "k".into(), ContextRole::View, 0);
        assert!(svc.list_subscriptions("ext.b").is_empty());
    }

    #[test]
    fn subscription_summary_serializes_camel_case() {
        let s = SubscriptionSummary {
            key: "timer".into(),
            role: ContextRole::Worker,
            installed_at: 42,
            listener_count: 3,
        };
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["key"], "timer");
        assert_eq!(json["role"], "worker");
        assert_eq!(json["installedAt"], 42);
        assert_eq!(json["listenerCount"], 3);
    }

    #[test]
    fn state_entry_serializes_camel_case() {
        let e = StateEntry {
            key: "timer".into(),
            value: serde_json::json!({ "secs": 5 }),
            updated_at: 42,
        };
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["key"], "timer");
        assert_eq!(json["value"], serde_json::json!({ "secs": 5 }));
        assert_eq!(json["updatedAt"], 42);
    }
}
