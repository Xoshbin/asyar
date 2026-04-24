//! Tauri command surface for the launcher-brokered state store + RPC primitive.
//!
//! Wire namespace: `state:*`. Five state commands and three RPC commands.
//! All are thin wrappers around [`crate::extensions::extension_state`] and
//! [`crate::extensions::extension_runtime`]; the inner functions take
//! injectable seams so tests can drive them without a live `AppHandle`.
//!
//! ## extensionId scoping
//!
//! Every command receives `extensionId` as a named parameter from the
//! frontend `ExtensionIpcRouter`, which auto-injects it from the calling
//! iframe's verified origin (the `INJECTS_EXTENSION_ID` set adds `state`
//! alongside `storage`/`cache`/`preferences`/etc.). Extensions never claim
//! their own id — same pattern as today's `storage:*`. No `PERMISSION_MAP`
//! entries are added; per-extension scoping is enforced by injection, not
//! by manifest permissions, mirroring `storage:*`'s rationale.

use crate::error::AppError;
use crate::extensions::extension_runtime::{
    emitter::{emit_typed, EventEmitter, TauriEventEmitter},
    wire::IpcDispatchOutcome,
    DispatchOutcome, ExtensionRuntimeManager, MessageKind, PendingMessage, TriggerSource,
    types::ContextRole,
    EVENT_DEGRADED, EVENT_MOUNT,
};
use crate::extensions::extension_state::{
    ExtensionStateService, RpcReplyPayload, SubscriptionId,
};
use serde_json::Value;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, State};

// ── Pure inner functions (testable without AppHandle) ────────────────────

pub(crate) fn state_get_inner(
    svc: &ExtensionStateService,
    extension_id: &str,
    key: &str,
) -> Result<Option<Value>, AppError> {
    svc.get(extension_id, key)
}

pub(crate) fn state_set_inner(
    svc: &ExtensionStateService,
    extension_id: &str,
    key: &str,
    value: Value,
    now_ms: u64,
) -> Result<(), AppError> {
    svc.set(extension_id, key, value, now_ms)
}

pub(crate) fn state_subscribe_inner(
    svc: &ExtensionStateService,
    extension_id: String,
    key: String,
    role: ContextRole,
) -> Result<SubscriptionId, AppError> {
    Ok(svc.subscribe(extension_id, key, role))
}

pub(crate) fn state_unsubscribe_inner(
    svc: &ExtensionStateService,
    subscription_id: SubscriptionId,
) -> Result<(), AppError> {
    svc.unsubscribe(subscription_id)
}

pub(crate) fn state_clear_inner(
    svc: &ExtensionStateService,
    extension_id: &str,
) -> Result<u64, AppError> {
    svc.clear(extension_id)
}

/// View → worker: enqueue an `__rpc__` envelope into the worker mailbox so
/// the request survives Dormant/Mounting and lands when the worker reaches
/// Ready. `MessageKind::Action` keeps the existing wire+drain path intact;
/// the worker-side SDK detects `__rpc__` payloads and routes to onRequest
/// handlers instead of the user's action dispatcher.
///
/// Returns the full `DispatchOutcome` so the frontend caller can:
///   - post `ReadyDeliverNow` messages directly to the worker iframe
///     (previously the worker was already mounted, so queuing without
///     delivery caused a silent 5s timeout on every rpc request);
///   - observe `NeedsMount` / `Degraded` as-emitted via the emitter.
///
/// Mirrors `dispatch_to_extension_inner`'s outcome-return pattern.
pub(crate) fn state_rpc_request_inner(
    mgr: &ExtensionRuntimeManager,
    emitter: &dyn EventEmitter,
    extension_id: &str,
    handler_id: String,
    correlation_id: String,
    payload: Value,
    now: Instant,
) -> Result<IpcDispatchOutcome, AppError> {
    let outcome = mgr.enqueue_worker(
        extension_id,
        PendingMessage {
            kind: MessageKind::Action,
            payload: serde_json::json!({
                "__rpc__": "request",
                "id": handler_id,
                "correlationId": correlation_id,
                "payload": payload,
            }),
            enqueued_at: now,
            source: TriggerSource::Invoke,
        },
        now,
    );
    emit_mount_or_degraded(emitter, extension_id, &outcome);
    Ok(outcome.into())
}

/// View → worker: ask the worker-side SDK to abort the in-flight handler
/// matching `correlation_id`. Same envelope mechanism as request — Action
/// kind, `__rpc__` discriminator. Worker-side SDK looks up the in-flight
/// AbortController and fires `.abort()`; handlers that ignore the signal
/// produce a detectable leak (their late reply is silently dropped view-side).
///
/// Returns the `DispatchOutcome` for the same reason as `state_rpc_request`:
/// a Ready worker needs the abort envelope delivered to its iframe.
pub(crate) fn state_rpc_abort_inner(
    mgr: &ExtensionRuntimeManager,
    emitter: &dyn EventEmitter,
    extension_id: &str,
    correlation_id: String,
    now: Instant,
) -> Result<IpcDispatchOutcome, AppError> {
    let outcome = mgr.enqueue_worker(
        extension_id,
        PendingMessage {
            kind: MessageKind::Action,
            payload: serde_json::json!({
                "__rpc__": "abort",
                "correlationId": correlation_id,
            }),
            enqueued_at: now,
            source: TriggerSource::Invoke,
        },
        now,
    );
    emit_mount_or_degraded(emitter, extension_id, &outcome);
    Ok(outcome.into())
}

/// Shared helper — mirrors `dispatch_to_extension_inner`'s emit logic for
/// the RPC worker-enqueue paths. Worker role is implicit (both callers
/// only ever target the worker context).
fn emit_mount_or_degraded(
    emitter: &dyn EventEmitter,
    extension_id: &str,
    outcome: &DispatchOutcome,
) {
    if let DispatchOutcome::NeedsMount { mount_token } = outcome {
        emit_typed(
            emitter,
            EVENT_MOUNT,
            &serde_json::json!({
                "extensionId": extension_id,
                "mountToken": mount_token,
                "role": ContextRole::Worker,
            }),
        );
    }
    if let DispatchOutcome::Degraded { strikes } = outcome {
        emit_typed(
            emitter,
            EVENT_DEGRADED,
            &serde_json::json!({
                "extensionId": extension_id,
                "strikes": strikes,
                "role": ContextRole::Worker,
            }),
        );
    }
}

/// Worker → view: relay the reply via the launcher emitter. The view-side
/// push bridge picks it up off the `asyar:state-rpc-reply` Tauri event and
/// posts it into the view iframe; the SDK matches on `correlationId`.
pub(crate) fn state_rpc_reply_inner(
    svc: &ExtensionStateService,
    extension_id: String,
    correlation_id: String,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), AppError> {
    svc.relay_rpc_reply(RpcReplyPayload {
        extension_id,
        correlation_id,
        result,
        error,
    });
    Ok(())
}

// ── Tauri command wrappers ───────────────────────────────────────────────

#[tauri::command]
pub fn state_get(
    extension_id: String,
    key: String,
    svc: State<'_, Arc<ExtensionStateService>>,
) -> Result<Option<Value>, AppError> {
    state_get_inner(&svc, &extension_id, &key)
}

#[tauri::command]
pub fn state_set(
    extension_id: String,
    key: String,
    value: Value,
    svc: State<'_, Arc<ExtensionStateService>>,
) -> Result<(), AppError> {
    state_set_inner(&svc, &extension_id, &key, value, crate::shell::now_millis())
}

#[tauri::command]
pub fn state_subscribe(
    extension_id: String,
    key: String,
    role: ContextRole,
    svc: State<'_, Arc<ExtensionStateService>>,
) -> Result<SubscriptionId, AppError> {
    state_subscribe_inner(&svc, extension_id, key, role)
}

#[tauri::command]
pub fn state_unsubscribe(
    subscription_id: SubscriptionId,
    svc: State<'_, Arc<ExtensionStateService>>,
) -> Result<(), AppError> {
    state_unsubscribe_inner(&svc, subscription_id)
}

#[tauri::command]
pub fn state_clear(
    extension_id: String,
    svc: State<'_, Arc<ExtensionStateService>>,
) -> Result<(), AppError> {
    state_clear_inner(&svc, &extension_id).map(|_| ())
}

#[tauri::command]
pub fn state_rpc_request(
    app: AppHandle,
    extension_id: String,
    id: String,
    correlation_id: String,
    payload: Value,
    mgr: State<'_, Arc<ExtensionRuntimeManager>>,
) -> Result<IpcDispatchOutcome, AppError> {
    let emitter = TauriEventEmitter { app };
    state_rpc_request_inner(
        &mgr,
        &emitter,
        &extension_id,
        id,
        correlation_id,
        payload,
        Instant::now(),
    )
}

#[tauri::command]
pub fn state_rpc_abort(
    app: AppHandle,
    extension_id: String,
    correlation_id: String,
    mgr: State<'_, Arc<ExtensionRuntimeManager>>,
) -> Result<IpcDispatchOutcome, AppError> {
    let emitter = TauriEventEmitter { app };
    state_rpc_abort_inner(&mgr, &emitter, &extension_id, correlation_id, Instant::now())
}

#[tauri::command]
pub fn state_rpc_reply(
    extension_id: String,
    correlation_id: String,
    result: Option<Value>,
    error: Option<String>,
    svc: State<'_, Arc<ExtensionStateService>>,
) -> Result<(), AppError> {
    state_rpc_reply_inner(&svc, extension_id, correlation_id, result, error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::extension_runtime::{
        emitter::RecordingEmitter,
        RuntimeConfig,
    };
    use crate::extensions::extension_state::RecordingStateEmitter;
    use crate::storage::extension_state as store;
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn fresh_svc_with_emitter() -> (Arc<ExtensionStateService>, Arc<RecordingStateEmitter>) {
        let conn = Connection::open_in_memory().unwrap();
        store::init_table(&conn).unwrap();
        let svc = Arc::new(ExtensionStateService::new(Arc::new(Mutex::new(conn))));
        let emitter: Arc<RecordingStateEmitter> = Arc::new(RecordingStateEmitter::default());
        svc.set_emitter(Box::new(Arc::clone(&emitter)));
        (svc, emitter)
    }

    // ── State commands ─────────────────────────────────────────────────────

    #[test]
    fn state_set_then_get_round_trips() {
        let (svc, _) = fresh_svc_with_emitter();
        state_set_inner(&svc, "ext.a", "k", serde_json::json!({ "n": 1 }), 0).unwrap();
        let v = state_get_inner(&svc, "ext.a", "k").unwrap();
        assert_eq!(v, Some(serde_json::json!({ "n": 1 })));
    }

    #[test]
    fn state_subscribe_returns_unique_id_then_unsubscribe_clears_it() {
        let (svc, emitter) = fresh_svc_with_emitter();
        let id =
            state_subscribe_inner(&svc, "ext.a".into(), "k".into(), ContextRole::View).unwrap();
        state_set_inner(&svc, "ext.a", "k", serde_json::json!(1), 0).unwrap();
        assert_eq!(emitter.changed().len(), 1);

        state_unsubscribe_inner(&svc, id).unwrap();
        state_set_inner(&svc, "ext.a", "k", serde_json::json!(2), 0).unwrap();
        assert_eq!(
            emitter.changed().len(),
            1,
            "second set must not fire after unsubscribe"
        );
    }

    #[test]
    fn state_clear_removes_rows_and_subscriptions() {
        let (svc, emitter) = fresh_svc_with_emitter();
        state_subscribe_inner(&svc, "ext.a".into(), "k".into(), ContextRole::View).unwrap();
        state_set_inner(&svc, "ext.a", "k", serde_json::json!(1), 0).unwrap();
        emitter.state_changed.lock().unwrap().clear();

        state_clear_inner(&svc, "ext.a").unwrap();
        assert_eq!(state_get_inner(&svc, "ext.a", "k").unwrap(), None);

        state_set_inner(&svc, "ext.a", "k", serde_json::json!(2), 0).unwrap();
        assert!(emitter.changed().is_empty(), "subscriptions dropped on clear");
    }

    // ── RPC reply routing ──────────────────────────────────────────────────

    #[test]
    fn state_rpc_reply_relays_through_emitter() {
        let (svc, emitter) = fresh_svc_with_emitter();
        state_rpc_reply_inner(
            &svc,
            "ext.a".into(),
            "cor-1".into(),
            Some(serde_json::json!({ "ok": true })),
            None,
        )
        .unwrap();
        let replies = emitter.replies();
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0].extension_id, "ext.a");
        assert_eq!(replies[0].correlation_id, "cor-1");
        assert_eq!(replies[0].result, Some(serde_json::json!({ "ok": true })));
    }

    #[test]
    fn state_rpc_reply_with_unknown_correlation_id_emits_anyway_for_view_to_filter() {
        // Rust does not track in-flight correlation ids — it is a pure
        // relay. The view-side SDK is the source of truth for "did I ask
        // for this?" because it has the pending-reply table. A reply with
        // a bogus correlationId reaches the view, view drops it silently.
        let (svc, emitter) = fresh_svc_with_emitter();
        state_rpc_reply_inner(
            &svc,
            "ext.a".into(),
            "stale".into(),
            Some(serde_json::json!(null)),
            None,
        )
        .unwrap();
        assert_eq!(emitter.replies().len(), 1, "Rust always relays; view filters");
    }

    // ── RPC request enqueuing into the worker mailbox ──────────────────────

    #[test]
    fn rpc_request_enqueues_into_worker_mailbox_with_envelope() {
        let mgr = ExtensionRuntimeManager::new(RuntimeConfig::default());
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        let outcome = state_rpc_request_inner(
            &mgr,
            &emitter,
            "ext.a",
            "start".into(),
            "cor-1".into(),
            serde_json::json!({ "minutes": 25 }),
            now,
        )
        .unwrap();
        // Dormant → Mounting transition must emit EVENT_MOUNT so the
        // frontend materialises the worker iframe; otherwise the queued
        // envelope sits forever and the view times out.
        let events = emitter.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, EVENT_MOUNT);
        assert_eq!(events[0].1["extensionId"], "ext.a");
        assert_eq!(events[0].1["role"], "worker");
        assert!(matches!(outcome, IpcDispatchOutcome::NeedsMount { .. }));
        let worker = mgr.worker.lock().unwrap();
        assert_eq!(worker.mailbox_len("ext.a"), 1, "envelope queued in mailbox");
    }

    #[test]
    fn rpc_request_on_ready_worker_returns_ready_deliver_now_with_envelope() {
        // Regression: before this fix, state_rpc_request_inner returned void
        // and discarded the outcome. For a Ready worker (the common case —
        // always-on worker iframe is already mounted), enqueue_worker does
        // NOT queue into the mailbox — it returns ReadyDeliverNow with the
        // message inline. The caller must deliver it to the worker iframe,
        // or the RPC sits undelivered and the view times out at 5s.
        let mgr = ExtensionRuntimeManager::new(RuntimeConfig::default());
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        // Walk the worker into Ready: mount, then ack.
        state_rpc_request_inner(&mgr, &emitter, "ext.a", "seed".into(), "cor-seed".into(), serde_json::json!({}), now).unwrap();
        let token = 1u64;
        mgr.on_ready_ack("ext.a", token, ContextRole::Worker, now);
        // Now the worker is Ready. A fresh rpc request should return
        // ReadyDeliverNow with the envelope available for immediate post.
        let outcome = state_rpc_request_inner(
            &mgr,
            &emitter,
            "ext.a",
            "start".into(),
            "cor-1".into(),
            serde_json::json!({ "x": 1 }),
            now,
        )
        .unwrap();
        match outcome {
            IpcDispatchOutcome::ReadyDeliverNow { messages } => {
                assert_eq!(messages.len(), 1);
                assert_eq!(messages[0].payload["__rpc__"], "request");
                assert_eq!(messages[0].payload["correlationId"], "cor-1");
            }
            other => panic!("expected ReadyDeliverNow, got {:?}", other),
        }
    }

    #[test]
    fn rpc_request_payload_carries_envelope_keys() {
        // Round-trip: enqueue, drain on ready-ack, inspect drained payload.
        let mgr = ExtensionRuntimeManager::new(RuntimeConfig::default());
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        state_rpc_request_inner(
            &mgr,
            &emitter,
            "ext.a",
            "start".into(),
            "cor-1".into(),
            serde_json::json!({ "x": 1 }),
            now,
        )
        .unwrap();
        // Find the Mounting token so we can ack readiness and drain.
        let token = {
            let worker = mgr.worker.lock().unwrap();
            match worker.snapshot_entries().into_iter().find(|e| e.extension_id == "ext.a") {
                Some(_) => 1u64, // first mount token starts at 1 per ContextMachine::new
                None => panic!("expected entry"),
            }
        };
        let drained = mgr.on_ready_ack("ext.a", token, ContextRole::Worker, now);
        assert_eq!(drained.len(), 1);
        let env = &drained[0].payload;
        assert_eq!(env["__rpc__"], "request");
        assert_eq!(env["id"], "start");
        assert_eq!(env["correlationId"], "cor-1");
        assert_eq!(env["payload"], serde_json::json!({ "x": 1 }));
        // Source must be Invoke so the runtime treats this as background
        // (not user-facing) for pending/degraded UX accounting.
        assert!(matches!(drained[0].source, TriggerSource::Invoke));
    }

    #[test]
    fn rpc_abort_enqueues_abort_envelope() {
        let mgr = ExtensionRuntimeManager::new(RuntimeConfig::default());
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        // Seed: first a request to put the worker into Mounting.
        state_rpc_request_inner(
            &mgr,
            &emitter,
            "ext.a",
            "start".into(),
            "cor-1".into(),
            serde_json::json!({}),
            now,
        )
        .unwrap();
        // Then abort.
        state_rpc_abort_inner(&mgr, &emitter, "ext.a", "cor-1".into(), now).unwrap();

        let token = 1u64;
        let drained = mgr.on_ready_ack("ext.a", token, ContextRole::Worker, now);
        assert_eq!(drained.len(), 2);
        let abort = drained.iter().find(|m| m.payload["__rpc__"] == "abort").unwrap();
        assert_eq!(abort.payload["correlationId"], "cor-1");
    }

    // ── Sanity: rpc-request on unknown ext still returns NeedsMount ───────

    #[test]
    fn rpc_request_on_unknown_ext_returns_needs_mount() {
        let mgr = ExtensionRuntimeManager::new(RuntimeConfig::default());
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        // The runtime doesn't know whether the extension is real — it just
        // tracks state per id. The IpcRouter (frontend) already gates on
        // registry membership before reaching this command, so a "rogue"
        // request never gets here in production. This test pins the
        // runtime's behaviour for a previously-unseen id.
        let outcome = state_rpc_request_inner(
            &mgr,
            &emitter,
            "ext.unknown",
            "x".into(),
            "c".into(),
            serde_json::json!({}),
            now,
        )
        .unwrap();
        assert!(matches!(outcome, IpcDispatchOutcome::NeedsMount { .. }));
        let worker = mgr.worker.lock().unwrap();
        let snap: Vec<_> = worker
            .snapshot_entries()
            .into_iter()
            .filter(|e| e.extension_id == "ext.unknown")
            .collect();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].state, "mounting");
    }
}
