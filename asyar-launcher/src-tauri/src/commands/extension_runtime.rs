//! Tauri-layer glue for ExtensionRuntimeManager. Commands are thin `#[tauri::command]`
//! wrappers over pure `*_inner` functions that take `&dyn EventEmitter`
//! for testability.

use crate::error::AppError;
use crate::extensions::extension_runtime::{
    emitter::{emit_typed, EventEmitter},
    manager::ExtensionRuntimeManager,
    types::*,
    wire::{IpcDispatchOutcome, IpcPendingMessage},
    EVENT_DEGRADED, EVENT_MOUNT, EVENT_UNMOUNT,
};
use std::sync::Arc;
use std::time::Instant;

pub(crate) fn dispatch_to_extension_inner(
    mgr: &ExtensionRuntimeManager,
    emitter: &dyn EventEmitter,
    extension_id: String,
    message: IpcPendingMessage,
    role: ContextRole,
    now: Instant,
) -> Result<IpcDispatchOutcome, AppError> {
    let outcome = match role {
        ContextRole::Worker => mgr.enqueue_worker(&extension_id, message.into_internal(now), now),
        ContextRole::View => mgr.enqueue_view(&extension_id, message.into_internal(now), now),
    };

    if let DispatchOutcome::NeedsMount { mount_token } = &outcome {
        emit_typed(
            emitter,
            EVENT_MOUNT,
            &serde_json::json!({
                "extensionId": extension_id,
                "mountToken": mount_token,
                "role": role,
            }),
        );
    }
    if let DispatchOutcome::Degraded { strikes } = &outcome {
        emit_typed(
            emitter,
            EVENT_DEGRADED,
            &serde_json::json!({
                "extensionId": extension_id,
                "strikes": strikes,
                "role": role,
            }),
        );
    }
    Ok(outcome.into())
}

pub(crate) fn iframe_ready_ack_inner(
    mgr: &ExtensionRuntimeManager,
    extension_id: String,
    mount_token: u64,
    role: ContextRole,
    now: Instant,
) -> Result<Vec<IpcPendingMessage>, AppError> {
    let drained = mgr.on_ready_ack(&extension_id, mount_token, role, now);
    Ok(drained.into_iter().map(Into::into).collect())
}

pub(crate) fn iframe_unmount_ack_inner(
    mgr: &ExtensionRuntimeManager,
    extension_id: String,
    role: ContextRole,
) -> Result<(), AppError> {
    mgr.on_unmount_ack(&extension_id, role);
    Ok(())
}

pub(crate) fn iframe_mount_timeout_reported_inner(
    mgr: &ExtensionRuntimeManager,
    emitter: &dyn EventEmitter,
    extension_id: String,
    mount_token: u64,
    role: ContextRole,
    now: Instant,
) -> Result<(), AppError> {
    let outcome = mgr.on_mount_timeout(&extension_id, mount_token, role, now);
    emit_typed(
        emitter,
        EVENT_UNMOUNT,
        &serde_json::json!({
            "extensionId": extension_id,
            "reason": "timeout",
            "role": role,
        }),
    );
    if outcome.transition_to_degraded {
        emit_typed(
            emitter,
            EVENT_DEGRADED,
            &serde_json::json!({
                "extensionId": extension_id,
                "strikes": outcome.new_strike_count,
                "role": role,
            }),
        );
    }
    Ok(())
}

pub(crate) fn get_extension_runtime_snapshot_inner(
    mgr: &ExtensionRuntimeManager,
) -> Result<Vec<ContextSnapshotEntry>, AppError> {
    Ok(mgr.snapshot_entries())
}

// ── Tauri command wrappers ──────────────────────────────────────────────────
use crate::extensions::extension_runtime::emitter::TauriEventEmitter;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn dispatch_to_extension(
    app: AppHandle,
    mgr: State<'_, Arc<ExtensionRuntimeManager>>,
    extension_id: String,
    message: IpcPendingMessage,
    role: ContextRole,
) -> Result<IpcDispatchOutcome, AppError> {
    let emitter = TauriEventEmitter { app };
    dispatch_to_extension_inner(
        &mgr,
        &emitter,
        extension_id,
        message,
        role,
        Instant::now(),
    )
}

#[tauri::command]
pub fn iframe_ready_ack(
    mgr: State<'_, Arc<ExtensionRuntimeManager>>,
    extension_id: String,
    mount_token: u64,
    role: ContextRole,
) -> Result<Vec<IpcPendingMessage>, AppError> {
    iframe_ready_ack_inner(&mgr, extension_id, mount_token, role, Instant::now())
}

#[tauri::command]
pub fn iframe_unmount_ack(
    mgr: State<'_, Arc<ExtensionRuntimeManager>>,
    extension_id: String,
    role: ContextRole,
) -> Result<(), AppError> {
    iframe_unmount_ack_inner(&mgr, extension_id, role)
}

#[tauri::command]
pub fn iframe_mount_timeout_reported(
    app: AppHandle,
    mgr: State<'_, Arc<ExtensionRuntimeManager>>,
    extension_id: String,
    mount_token: u64,
    role: ContextRole,
) -> Result<(), AppError> {
    let emitter = TauriEventEmitter { app };
    iframe_mount_timeout_reported_inner(
        &mgr,
        &emitter,
        extension_id,
        mount_token,
        role,
        Instant::now(),
    )
}

#[tauri::command]
pub fn get_extension_runtime_snapshot(
    mgr: State<'_, Arc<ExtensionRuntimeManager>>,
) -> Result<Vec<ContextSnapshotEntry>, AppError> {
    get_extension_runtime_snapshot_inner(&mgr)
}

#[tauri::command]
pub fn force_remount_worker(
    app: AppHandle,
    mgr: State<'_, Arc<ExtensionRuntimeManager>>,
    extension_id: String,
    has_background_main: bool,
) -> Result<(), AppError> {
    let emitter = TauriEventEmitter { app };
    force_remount_worker_inner(
        &mgr,
        &emitter,
        extension_id,
        has_background_main,
        Instant::now(),
    )
}

/// Phase 2.1 always-on worker auto-mount. Called by the enable path
/// (`lifecycle::set_enabled` when `enabled=true`) and the post-discovery
/// restoration loop so that extensions with `background.main` get their
/// worker iframe spawned without waiting for a user dispatch.
///
/// Returns `true` when an `EVENT_MOUNT` was emitted. No-op when the extension
/// has no background entrypoint, or when the worker context is already
/// Mounting/Ready/Degraded (idempotent).
pub(crate) fn auto_mount_worker_inner(
    mgr: &ExtensionRuntimeManager,
    emitter: &dyn EventEmitter,
    has_background_main: bool,
    extension_id: String,
    now: Instant,
) -> bool {
    if !has_background_main {
        return false;
    }
    match mgr.ensure_worker_mounted(&extension_id, now) {
        Some(mount_token) => {
            emit_typed(
                emitter,
                EVENT_MOUNT,
                &serde_json::json!({
                    "extensionId": extension_id,
                    "mountToken": mount_token,
                    "role": ContextRole::Worker,
                }),
            );
            true
        }
        None => false,
    }
}

/// Tauri wrapper for `auto_mount_worker_inner` — builds a `TauriEventEmitter`
/// from the supplied `AppHandle`. Call from the enable / restoration paths.
pub fn auto_mount_worker(
    mgr: &Arc<ExtensionRuntimeManager>,
    app: &AppHandle,
    has_background_main: bool,
    extension_id: String,
) -> bool {
    let emitter = TauriEventEmitter { app: app.clone() };
    auto_mount_worker_inner(mgr, &emitter, has_background_main, extension_id, Instant::now())
}

/// Dev-only "Force Remount" action from the Phase 7 inspector. Tears down
/// the worker context for `extension_id` (emitting EVENT_UNMOUNT so the
/// WorkerIframes component drops its iframe), then transitions the worker
/// back to Mounting (emitting EVENT_MOUNT so a fresh iframe materialises).
///
/// Leaves the view context alone so a developer can bounce a worker
/// without disrupting a live view. Idempotent: if the worker had no state,
/// the unmount emit is suppressed; the mount emit still fires when the
/// caller confirms the extension has a background.main entry.
pub(crate) fn force_remount_worker_inner(
    mgr: &ExtensionRuntimeManager,
    emitter: &dyn EventEmitter,
    extension_id: String,
    has_background_main: bool,
    now: Instant,
) -> Result<(), AppError> {
    let worker_had = mgr.tear_down_worker(&extension_id);
    if worker_had {
        emit_typed(
            emitter,
            EVENT_UNMOUNT,
            &serde_json::json!({
                "extensionId": extension_id,
                "reason": "force-remount",
                "role": ContextRole::Worker,
            }),
        );
    }
    if !has_background_main {
        return Ok(());
    }
    if let Some(mount_token) = mgr.ensure_worker_mounted(&extension_id, now) {
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
    Ok(())
}

pub(crate) fn notify_extension_removed_inner(
    mgr: &ExtensionRuntimeManager,
    emitter: &dyn EventEmitter,
    extension_id: String,
) -> Result<(), AppError> {
    let (worker_had, view_had) = mgr.tear_down_both(&extension_id);
    if worker_had || view_had {
        emit_typed(
            emitter,
            EVENT_UNMOUNT,
            &serde_json::json!({
                "extensionId": extension_id,
                "reason": "uninstall",
            }),
        );
    }
    Ok(())
}

pub fn notify_extension_removed(
    mgr: &Arc<ExtensionRuntimeManager>,
    app: &AppHandle,
    extension_id: String,
) {
    let emitter = TauriEventEmitter { app: app.clone() };
    let _ = notify_extension_removed_inner(mgr, &emitter, extension_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::extension_runtime::emitter::RecordingEmitter;

    fn mgr() -> ExtensionRuntimeManager {
        ExtensionRuntimeManager::new(RuntimeConfig::default())
    }

    fn ipc(src: TriggerSource) -> IpcPendingMessage {
        IpcPendingMessage {
            kind: MessageKind::Command,
            payload: serde_json::json!({"commandId": "x"}),
            source: src,
        }
    }

    #[test]
    fn dormant_dispatch_emits_mount_event_with_role_and_returns_needs_mount() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let out = dispatch_to_extension_inner(
            &mgr,
            &emitter,
            "ext.a".into(),
            ipc(TriggerSource::Search),
            ContextRole::View,
            Instant::now(),
        )
        .unwrap();
        assert!(matches!(out, IpcDispatchOutcome::NeedsMount { .. }));
        let events = emitter.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, EVENT_MOUNT);
        assert_eq!(events[0].1["extensionId"], "ext.a");
        assert_eq!(events[0].1["role"], "view");
    }

    #[test]
    fn mounting_follow_up_dispatch_emits_nothing_and_returns_waiting() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Search), ContextRole::View, now,
        ).unwrap();
        let out = dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Argument), ContextRole::View, now,
        ).unwrap();
        assert!(matches!(out, IpcDispatchOutcome::MountingWaitForReady));
        assert_eq!(emitter.events().len(), 1);
    }

    #[test]
    fn ready_ack_returns_drained_ipc_messages() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        let out = dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Search), ContextRole::View, now,
        ).unwrap();
        let token = match out {
            IpcDispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        let drained =
            iframe_ready_ack_inner(&mgr, "ext.a".into(), token, ContextRole::View, now).unwrap();
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].source, TriggerSource::Search);
    }

    #[test]
    fn ready_ack_with_bad_token_returns_empty() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Search), ContextRole::View, now,
        ).unwrap();
        let drained =
            iframe_ready_ack_inner(&mgr, "ext.a".into(), 9999, ContextRole::View, now).unwrap();
        assert!(drained.is_empty());
    }

    #[test]
    fn unmount_ack_clears_state_to_dormant() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Search), ContextRole::View, Instant::now(),
        ).unwrap();
        iframe_unmount_ack_inner(&mgr, "ext.a".into(), ContextRole::View).unwrap();
        let out = dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Search), ContextRole::View, Instant::now(),
        ).unwrap();
        assert!(matches!(out, IpcDispatchOutcome::NeedsMount { .. }));
    }

    #[test]
    fn mount_timeout_reported_triggers_strike_and_unmount_event_with_role() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        let out = dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Search), ContextRole::View, now,
        ).unwrap();
        let token = match out {
            IpcDispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        iframe_mount_timeout_reported_inner(
            &mgr, &emitter, "ext.a".into(), token, ContextRole::View, now,
        ).unwrap();
        let events = emitter.events();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].0, EVENT_UNMOUNT);
        assert_eq!(events[1].1["reason"], "timeout");
        assert_eq!(events[1].1["role"], "view");
    }

    #[test]
    fn snapshot_returns_known_extension_ids_state_names_and_role() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Search), ContextRole::View, Instant::now(),
        ).unwrap();
        let snap = get_extension_runtime_snapshot_inner(&mgr).unwrap();
        let entry = snap.iter().find(|e| e.extension_id == "ext.a").unwrap();
        assert_eq!(entry.state, "mounting");
        assert_eq!(entry.role, ContextRole::View);
    }

    #[test]
    fn worker_dispatch_routes_to_worker_context_and_emits_role_worker() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let out = dispatch_to_extension_inner(
            &mgr,
            &emitter,
            "ext.a".into(),
            ipc(TriggerSource::Schedule),
            ContextRole::Worker,
            Instant::now(),
        )
        .unwrap();
        assert!(matches!(out, IpcDispatchOutcome::NeedsMount { .. }));
        let events = emitter.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, EVENT_MOUNT);
        assert_eq!(
            events[0].1["role"], "worker",
            "worker dispatch must emit mount event with role=worker, got: {:?}",
            events[0].1["role"]
        );
    }

    #[test]
    fn worker_and_view_dispatch_use_independent_state_machines() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        let worker_out = dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Schedule), ContextRole::Worker, now,
        ).unwrap();
        let view_out = dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Search), ContextRole::View, now,
        ).unwrap();
        assert!(matches!(worker_out, IpcDispatchOutcome::NeedsMount { .. }),
            "worker dispatch must need mount");
        assert!(matches!(view_out, IpcDispatchOutcome::NeedsMount { .. }),
            "view dispatch must independently need mount");
        let events = emitter.events();
        assert_eq!(events.len(), 2, "both worker and view must emit mount events independently");
        let roles: Vec<&str> = events.iter()
            .map(|(_, v)| v["role"].as_str().unwrap_or(""))
            .collect();
        assert!(roles.contains(&"worker"), "must have worker mount event");
        assert!(roles.contains(&"view"), "must have view mount event");
    }

    #[test]
    fn extension_removed_clears_both_machines_and_emits_unmount() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        dispatch_to_extension_inner(
            &mgr, &emitter, "ext.a".into(), ipc(TriggerSource::Search), ContextRole::View, Instant::now(),
        ).unwrap();
        notify_extension_removed_inner(&mgr, &emitter, "ext.a".into()).unwrap();
        let events = emitter.events();
        let last = events.last().unwrap();
        assert_eq!(last.0, EVENT_UNMOUNT);
        assert_eq!(last.1["reason"], "uninstall");
    }

    // ── force_remount_worker_inner (Phase 7 dev inspector) ─────────────────

    #[test]
    fn force_remount_worker_bouncing_ready_worker_emits_unmount_then_mount() {
        // Steady-state: worker was mounted and is Ready. The inspector
        // click must emit EVENT_UNMOUNT (so WorkerIframes drops the iframe)
        // followed by EVENT_MOUNT (so a fresh iframe materialises).
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        // Walk the worker into Ready via auto_mount + ready ack.
        auto_mount_worker_inner(&mgr, &emitter, true, "ext.a".into(), now);
        mgr.on_ready_ack("ext.a", 1, ContextRole::Worker, now);
        emitter.emissions.lock().unwrap().clear();

        force_remount_worker_inner(&mgr, &emitter, "ext.a".into(), true, now).unwrap();
        let events = emitter.events();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].0, EVENT_UNMOUNT);
        assert_eq!(events[0].1["reason"], "force-remount");
        assert_eq!(events[0].1["role"], "worker");
        assert_eq!(events[1].0, EVENT_MOUNT);
        assert_eq!(events[1].1["role"], "worker");
    }

    #[test]
    fn force_remount_worker_on_dormant_extension_emits_only_mount() {
        // No prior worker state → nothing to unmount, but we still need the
        // fresh mount emit so the inspector click materialises an iframe.
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        force_remount_worker_inner(&mgr, &emitter, "ext.a".into(), true, now).unwrap();
        let events = emitter.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, EVENT_MOUNT);
        assert_eq!(events[0].1["role"], "worker");
    }

    #[test]
    fn force_remount_worker_without_background_main_is_noop_when_dormant() {
        // Extension has no background.main, and worker was never mounted:
        // nothing to do. No events emitted, no state change.
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        force_remount_worker_inner(&mgr, &emitter, "ext.a".into(), false, now).unwrap();
        assert!(emitter.events().is_empty(), "no events when nothing to do");
        assert!(mgr.worker.lock().unwrap().state("ext.a").is_none());
    }

    #[test]
    fn force_remount_worker_leaves_view_context_alone() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        // Seed a view context.
        dispatch_to_extension_inner(
            &mgr,
            &emitter,
            "ext.a".into(),
            ipc(TriggerSource::Search),
            ContextRole::View,
            now,
        )
        .unwrap();
        emitter.emissions.lock().unwrap().clear();

        force_remount_worker_inner(&mgr, &emitter, "ext.a".into(), true, now).unwrap();
        // View context must still be in Mounting — the worker remount
        // must not reach into the view machine.
        assert!(
            mgr.view.lock().unwrap().state("ext.a").is_some(),
            "view context must survive a worker-only remount"
        );
    }

    // ── auto_mount_worker_inner (Phase 2.1 always-on worker hotfix) ───────────
    // Shared helper used by the enable path (lifecycle::set_enabled) and the
    // app-startup / post-discovery restoration loop. Gates on `has_background_main`
    // so callers can safely pass every extension in the registry.

    #[test]
    fn auto_mount_worker_inner_emits_mount_with_role_worker_when_bg_main_and_dormant() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let did_emit = auto_mount_worker_inner(
            &mgr,
            &emitter,
            true, // has_background_main
            "ext.a".into(),
            Instant::now(),
        );
        assert!(did_emit, "dormant worker with bg.main must emit");
        let events = emitter.events();
        assert_eq!(events.len(), 1, "exactly one mount event");
        assert_eq!(events[0].0, EVENT_MOUNT);
        assert_eq!(events[0].1["extensionId"], "ext.a");
        assert_eq!(events[0].1["role"], "worker");
        assert!(events[0].1["mountToken"].is_number());
    }

    #[test]
    fn auto_mount_worker_inner_emits_nothing_when_bg_main_is_false() {
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let did_emit = auto_mount_worker_inner(
            &mgr,
            &emitter,
            false, // no background.main
            "ext.a".into(),
            Instant::now(),
        );
        assert!(!did_emit);
        assert!(emitter.events().is_empty(), "no emit when extension has no background");
        // Worker machine is unchanged (still has no state for ext.a).
        assert!(mgr.worker.lock().unwrap().state("ext.a").is_none());
    }

    #[test]
    fn auto_mount_worker_inner_called_per_extension_in_mixed_list_emits_once() {
        // Simulates the post-discovery restoration loop: iterate enabled
        // extensions, skip those without background.main. Two extensions,
        // one with bg.main and one without — exactly one mount emit, and
        // it carries role: worker.
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();

        let enabled: Vec<(&str, bool)> = vec![
            ("ext.bg", true),   // background worker extension
            ("ext.view", false), // view-only extension
        ];
        let mut emit_count = 0;
        for (id, has_bg) in enabled {
            if auto_mount_worker_inner(&mgr, &emitter, has_bg, id.to_string(), now) {
                emit_count += 1;
            }
        }
        assert_eq!(emit_count, 1, "only the bg.main extension triggers an emit");
        let events = emitter.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1["extensionId"], "ext.bg");
        assert_eq!(events[0].1["role"], "worker");
    }

    #[test]
    fn auto_mount_worker_inner_then_notify_extension_removed_tears_down_worker_context() {
        // Enable path emits a mount → frontend would spawn an iframe.
        // Disable path then calls notify_extension_removed → worker context
        // must be torn down so no leak, and the next enable gets a fresh token.
        let mgr = mgr();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();

        auto_mount_worker_inner(&mgr, &emitter, true, "ext.a".into(), now);
        assert!(matches!(
            mgr.worker.lock().unwrap().state("ext.a"),
            Some(LifecycleState::Mounting { .. })
        ));

        notify_extension_removed_inner(&mgr, &emitter, "ext.a".into()).unwrap();
        assert!(
            mgr.worker.lock().unwrap().state("ext.a").is_none(),
            "disable must tear down worker context"
        );
        assert!(
            mgr.view.lock().unwrap().state("ext.a").is_none(),
            "disable tears down view context too (tear_down_both)"
        );

        // Re-enabling after teardown must produce a fresh token (not reuse stale one).
        let events_before = emitter.events().len();
        auto_mount_worker_inner(&mgr, &emitter, true, "ext.a".into(), now);
        let events_after = emitter.events();
        assert_eq!(
            events_after.len(),
            events_before + 1,
            "re-enable must emit a new mount event"
        );
        assert_eq!(events_after.last().unwrap().1["role"], "worker");
    }
}
