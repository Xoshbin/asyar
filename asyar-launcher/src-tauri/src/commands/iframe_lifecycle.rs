//! Tauri-layer glue for IframeLifecycle. Commands are thin `#[tauri::command]`
//! wrappers over pure `*_inner` functions that take `&dyn EventEmitter`
//! for testability.

use crate::error::AppError;
use crate::extensions::iframe_lifecycle::{
    emitter::{emit_typed, EventEmitter},
    types::*,
    wire::{IpcDispatchOutcome, IpcPendingMessage},
    IframeLifecycle,
};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub const EVENT_MOUNT: &str = "asyar:iframe:mount";
pub const EVENT_UNMOUNT: &str = "asyar:iframe:unmount";
pub const EVENT_DELIVER: &str = "asyar:iframe:deliver";
pub const EVENT_DEGRADED: &str = "asyar:iframe:degraded";
pub const EVENT_RECOVERED: &str = "asyar:iframe:recovered";

pub struct IframeLifecycleState(pub Arc<Mutex<IframeLifecycle>>);

pub(crate) fn dispatch_to_extension_inner(
    lc: &Mutex<IframeLifecycle>,
    emitter: &dyn EventEmitter,
    extension_id: String,
    message: IpcPendingMessage,
    now: Instant,
) -> Result<IpcDispatchOutcome, AppError> {
    let mut guard = lc
        .lock()
        .map_err(|_| AppError::Other("lifecycle lock poisoned".into()))?;
    let outcome = guard.enqueue(&extension_id, message.into_internal(now), now);

    if let DispatchOutcome::NeedsMount { mount_token } = &outcome {
        emit_typed(
            emitter,
            EVENT_MOUNT,
            &serde_json::json!({ "extensionId": extension_id, "mountToken": mount_token }),
        );
    }
    if let DispatchOutcome::Degraded { strikes } = &outcome {
        emit_typed(
            emitter,
            EVENT_DEGRADED,
            &serde_json::json!({ "extensionId": extension_id, "strikes": strikes }),
        );
    }
    Ok(outcome.into())
}

pub(crate) fn iframe_ready_ack_inner(
    lc: &Mutex<IframeLifecycle>,
    extension_id: String,
    mount_token: u64,
    now: Instant,
) -> Result<Vec<IpcPendingMessage>, AppError> {
    let mut guard = lc
        .lock()
        .map_err(|_| AppError::Other("lifecycle lock poisoned".into()))?;
    let drained = guard.on_ready_ack(&extension_id, mount_token, now);
    Ok(drained.into_iter().map(Into::into).collect())
}

pub(crate) fn iframe_unmount_ack_inner(
    lc: &Mutex<IframeLifecycle>,
    extension_id: String,
) -> Result<(), AppError> {
    let mut guard = lc.lock().map_err(|_| AppError::Other("lifecycle lock poisoned".into()))?;
    guard.on_unmount_ack(&extension_id);
    Ok(())
}

pub(crate) fn iframe_mount_timeout_reported_inner(
    lc: &Mutex<IframeLifecycle>,
    emitter: &dyn EventEmitter,
    extension_id: String,
    mount_token: u64,
    now: Instant,
) -> Result<(), AppError> {
    let outcome = {
        let mut guard = lc.lock().map_err(|_| AppError::Other("lifecycle lock poisoned".into()))?;
        guard.on_mount_timeout(&extension_id, mount_token, now)
    };
    emit_typed(
        emitter,
        EVENT_UNMOUNT,
        &serde_json::json!({ "extensionId": extension_id, "reason": "timeout" }),
    );
    if outcome.transition_to_degraded {
        emit_typed(
            emitter,
            EVENT_DEGRADED,
            &serde_json::json!({ "extensionId": extension_id, "strikes": outcome.new_strike_count }),
        );
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IframeLifecycleSnapshotEntry {
    pub extension_id: String,
    pub state: String,
    pub mailbox_len: usize,
}

pub(crate) fn get_iframe_lifecycle_snapshot_inner(
    lc: &Mutex<IframeLifecycle>,
) -> Result<Vec<IframeLifecycleSnapshotEntry>, AppError> {
    let guard = lc.lock().map_err(|_| AppError::Other("lifecycle lock poisoned".into()))?;
    Ok(guard.snapshot_entries())
}

// ── Tauri command wrappers ──────────────────────────────────────────────────
use tauri::{AppHandle, State};
use crate::extensions::iframe_lifecycle::emitter::TauriEventEmitter;

#[tauri::command]
pub fn dispatch_to_extension(
    app: AppHandle,
    lc: State<'_, IframeLifecycleState>,
    extension_id: String,
    message: IpcPendingMessage,
) -> Result<IpcDispatchOutcome, AppError> {
    let emitter = TauriEventEmitter { app };
    dispatch_to_extension_inner(&lc.0, &emitter, extension_id, message, Instant::now())
}

#[tauri::command]
pub fn iframe_ready_ack(
    lc: State<'_, IframeLifecycleState>,
    extension_id: String,
    mount_token: u64,
) -> Result<Vec<IpcPendingMessage>, AppError> {
    iframe_ready_ack_inner(&lc.0, extension_id, mount_token, Instant::now())
}

#[tauri::command]
pub fn iframe_unmount_ack(
    lc: State<'_, IframeLifecycleState>,
    extension_id: String,
) -> Result<(), AppError> {
    iframe_unmount_ack_inner(&lc.0, extension_id)
}

#[tauri::command]
pub fn iframe_mount_timeout_reported(
    app: AppHandle,
    lc: State<'_, IframeLifecycleState>,
    extension_id: String,
    mount_token: u64,
) -> Result<(), AppError> {
    let emitter = TauriEventEmitter { app };
    iframe_mount_timeout_reported_inner(&lc.0, &emitter, extension_id, mount_token, Instant::now())
}

#[tauri::command]
pub fn get_iframe_lifecycle_snapshot(
    lc: State<'_, IframeLifecycleState>,
) -> Result<Vec<IframeLifecycleSnapshotEntry>, AppError> {
    get_iframe_lifecycle_snapshot_inner(&lc.0)
}

pub(crate) fn notify_extension_removed_inner(
    lc: &Mutex<IframeLifecycle>,
    emitter: &dyn EventEmitter,
    extension_id: String,
) -> Result<(), AppError> {
    let had = {
        let mut guard = lc.lock().map_err(|_| AppError::Other("lifecycle lock poisoned".into()))?;
        guard.on_extension_removed(&extension_id)
    };
    if had {
        emit_typed(
            emitter,
            EVENT_UNMOUNT,
            &serde_json::json!({ "extensionId": extension_id, "reason": "uninstall" }),
        );
    }
    Ok(())
}

pub fn notify_extension_removed(lc: &IframeLifecycleState, app: &AppHandle, extension_id: String) {
    let emitter = TauriEventEmitter { app: app.clone() };
    let _ = notify_extension_removed_inner(&lc.0, &emitter, extension_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::iframe_lifecycle::emitter::RecordingEmitter;

    fn lc() -> Mutex<IframeLifecycle> {
        Mutex::new(IframeLifecycle::new(LifecycleConfig::default()))
    }

    fn ipc(src: TriggerSource) -> IpcPendingMessage {
        IpcPendingMessage {
            kind: MessageKind::Command,
            payload: serde_json::json!({"commandId": "x"}),
            source: src,
        }
    }

    #[test]
    fn dormant_dispatch_emits_mount_event_and_returns_needs_mount() {
        let lc = lc();
        let emitter = RecordingEmitter::default();
        let out = dispatch_to_extension_inner(
            &lc, &emitter, "ext.a".into(), ipc(TriggerSource::Search), Instant::now(),
        ).unwrap();
        assert!(matches!(out, IpcDispatchOutcome::NeedsMount { .. }));
        let events = emitter.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, EVENT_MOUNT);
        assert_eq!(events[0].1["extensionId"], "ext.a");
    }

    #[test]
    fn mounting_follow_up_dispatch_emits_nothing_and_returns_waiting() {
        let lc = lc();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        dispatch_to_extension_inner(&lc, &emitter, "ext.a".into(), ipc(TriggerSource::Search), now).unwrap();
        let out = dispatch_to_extension_inner(&lc, &emitter, "ext.a".into(), ipc(TriggerSource::Argument), now).unwrap();
        assert!(matches!(out, IpcDispatchOutcome::MountingWaitForReady));
        assert_eq!(emitter.events().len(), 1);
    }

    #[test]
    fn ready_ack_returns_drained_ipc_messages() {
        let lc = lc();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();

        let out = dispatch_to_extension_inner(&lc, &emitter, "ext.a".into(), ipc(TriggerSource::Search), now).unwrap();
        let token = match out {
            IpcDispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };

        let drained = iframe_ready_ack_inner(&lc, "ext.a".into(), token, now).unwrap();
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].source, TriggerSource::Search);
    }

    #[test]
    fn ready_ack_with_bad_token_returns_empty() {
        let lc = lc();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        dispatch_to_extension_inner(&lc, &emitter, "ext.a".into(), ipc(TriggerSource::Search), now).unwrap();
        let drained = iframe_ready_ack_inner(&lc, "ext.a".into(), 9999, now).unwrap();
        assert!(drained.is_empty());
    }

    #[test]
    fn unmount_ack_clears_state_to_dormant() {
        let lc = lc();
        let emitter = RecordingEmitter::default();
        dispatch_to_extension_inner(&lc, &emitter, "ext.a".into(), ipc(TriggerSource::Search), Instant::now()).unwrap();
        iframe_unmount_ack_inner(&lc, "ext.a".into()).unwrap();
        let out = dispatch_to_extension_inner(&lc, &emitter, "ext.a".into(), ipc(TriggerSource::Search), Instant::now()).unwrap();
        assert!(matches!(out, IpcDispatchOutcome::NeedsMount { .. }));
    }

    #[test]
    fn mount_timeout_reported_triggers_strike_and_unmount_event() {
        let lc = lc();
        let emitter = RecordingEmitter::default();
        let now = Instant::now();
        let out = dispatch_to_extension_inner(&lc, &emitter, "ext.a".into(), ipc(TriggerSource::Search), now).unwrap();
        let token = match out { IpcDispatchOutcome::NeedsMount { mount_token } => mount_token, _ => panic!() };

        iframe_mount_timeout_reported_inner(&lc, &emitter, "ext.a".into(), token, now).unwrap();
        let events = emitter.events();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].0, EVENT_UNMOUNT);
        assert_eq!(events[1].1["reason"], "timeout");
    }

    #[test]
    fn snapshot_returns_known_extension_ids_and_state_names() {
        let lc = lc();
        let emitter = RecordingEmitter::default();
        dispatch_to_extension_inner(&lc, &emitter, "ext.a".into(), ipc(TriggerSource::Search), Instant::now()).unwrap();
        let snap = get_iframe_lifecycle_snapshot_inner(&lc).unwrap();
        assert!(snap.iter().any(|e| e.extension_id == "ext.a" && e.state == "mounting"));
    }

    #[test]
    fn extension_removed_clears_state_and_emits_unmount() {
        let lc = lc();
        let emitter = RecordingEmitter::default();
        dispatch_to_extension_inner(&lc, &emitter, "ext.a".into(), ipc(TriggerSource::Search), Instant::now()).unwrap();
        notify_extension_removed_inner(&lc, &emitter, "ext.a".into()).unwrap();
        let events = emitter.events();
        let last = events.last().unwrap();
        assert_eq!(last.0, EVENT_UNMOUNT);
        assert_eq!(last.1["reason"], "uninstall");
    }
}
