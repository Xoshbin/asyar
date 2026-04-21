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
}
