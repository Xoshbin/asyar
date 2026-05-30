//! Extension background scheduler — manages tokio timers for declarative scheduled commands.

use log::warn;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tokio::task::JoinHandle;

use super::ExtensionRegistryState;
use crate::error::AppError;
use crate::extensions::extension_runtime::emitter::{emit_typed, EventEmitter};
use crate::extensions::extension_runtime::{
    ContextRole, DispatchOutcome, ExtensionRuntimeManager, MessageKind, PendingMessage,
    TriggerSource, EVENT_DELIVER, EVENT_MOUNT,
};
use std::sync::Arc;

const MIN_INTERVAL_SECS: u64 = 10;
const MAX_INTERVAL_SECS: u64 = 86400;

pub fn validate_interval(seconds: u64) -> Result<u64, AppError> {
    if !(MIN_INTERVAL_SECS..=MAX_INTERVAL_SECS).contains(&seconds) {
        return Err(AppError::Validation(format!(
            "Schedule interval must be between {} and {} seconds, got {}",
            MIN_INTERVAL_SECS, MAX_INTERVAL_SECS, seconds
        )));
    }
    Ok(seconds)
}

/// Tauri-managed state holding all active scheduler task handles.
pub struct SchedulerState {
    pub tasks: Mutex<HashMap<String, JoinHandle<()>>>,
}

impl SchedulerState {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for SchedulerState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerTickPayload {
    pub extension_id: String,
    pub command_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskInfo {
    pub extension_id: String,
    pub extension_name: String,
    pub command_id: String,
    pub command_name: String,
    pub interval_seconds: u64,
    pub active: bool,
}

/// Build the `PendingMessage` that the scheduler enqueues for a single tick.
///
/// Extracted from `spawn_timer` to create a pure, testable seam.
fn build_scheduled_command_message(command_id: &str, now: std::time::Instant) -> PendingMessage {
    PendingMessage {
        kind: MessageKind::Command,
        payload: serde_json::json!({
            "commandId": command_id,
            "args": { "scheduledTick": true },
        }),
        enqueued_at: now,
        source: TriggerSource::Schedule,
    }
}

/// Handle a `DispatchOutcome` from `enqueue_worker`, emitting Tauri events as needed.
///
/// Extracted from `spawn_timer` to create a pure, testable seam via `EventEmitter`.
fn handle_dispatch_outcome(
    emitter: &dyn EventEmitter,
    extension_id: &str,
    command_id: &str,
    outcome: &DispatchOutcome,
) {
    match outcome {
        DispatchOutcome::ReadyDeliverNow { messages } => {
            let serialized: Vec<serde_json::Value> = messages
                .iter()
                .map(|m| {
                    serde_json::json!({
                        "kind": m.kind,
                        "payload": m.payload,
                        "source": m.source,
                    })
                })
                .collect();
            emit_typed(
                emitter,
                EVENT_DELIVER,
                &serde_json::json!({
                    "extensionId": extension_id,
                    "role": ContextRole::Worker,
                    "messages": serialized,
                }),
            );
        }
        DispatchOutcome::NeedsMount { mount_token } => {
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
        DispatchOutcome::Degraded { strikes } => {
            warn!(
                "Scheduler: worker machine degraded for {}::{} (strikes={})",
                extension_id, command_id, strikes
            );
        }
        DispatchOutcome::MountingWaitForReady => {
            // Mailbox holds the message until the worker's ready ack drains it
            // via the existing readiness listener. No-op here.
        }
    }
}

/// Spawn a tokio task that dispatches a scheduled Command into the Worker machine.
fn spawn_timer(
    app_handle: AppHandle,
    extension_id: String,
    command_id: String,
    interval_secs: u64,
) -> JoinHandle<()> {
    use crate::extensions::extension_runtime::emitter::TauriEventEmitter;
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(interval_secs));
        // Skip the first tick (fires immediately by default)
        interval.tick().await;
        loop {
            interval.tick().await;
            let now = std::time::Instant::now();
            let msg = build_scheduled_command_message(&command_id, now);
            if let Some(mgr) = app_handle.try_state::<Arc<ExtensionRuntimeManager>>() {
                let outcome = mgr.enqueue_worker(&extension_id, msg, now);
                let emitter = TauriEventEmitter {
                    app: app_handle.clone(),
                };
                handle_dispatch_outcome(&emitter, &extension_id, &command_id, &outcome);
            } else {
                warn!(
                    "Scheduler: ExtensionRuntimeManager unavailable for {}::{}",
                    extension_id, command_id
                );
            }
        }
    })
}

/// Start scheduled tasks for ALL enabled extensions in the registry.
pub fn start_all_tasks(
    app_handle: &AppHandle,
    registry: &ExtensionRegistryState,
    scheduler: &SchedulerState,
) -> Result<(), AppError> {
    // Stop any existing tasks first
    stop_all_tasks(scheduler)?;

    let reg = registry.extensions.lock().map_err(|_| AppError::Lock)?;
    let mut tasks = scheduler.tasks.lock().map_err(|_| AppError::Lock)?;

    for (ext_id, record) in reg.iter() {
        if !record.enabled {
            continue;
        }
        if record.compatibility != crate::extensions::CompatibilityStatus::Compatible {
            continue;
        }
        for cmd in &record.manifest.commands {
            if let Some(ref schedule) = cmd.schedule {
                if validate_interval(schedule.interval_seconds).is_ok() {
                    let task_key = format!("{}::{}", ext_id, cmd.id);
                    let handle = spawn_timer(
                        app_handle.clone(),
                        ext_id.clone(),
                        cmd.id.clone(),
                        schedule.interval_seconds,
                    );
                    tasks.insert(task_key, handle);
                    log::info!(
                        "Scheduler: started timer for {}::{} (every {}s)",
                        ext_id,
                        cmd.id,
                        schedule.interval_seconds
                    );
                }
            }
        }
    }
    Ok(())
}

/// Start scheduled tasks for a single extension.
pub fn start_tasks_for_extension(
    app_handle: &AppHandle,
    registry: &ExtensionRegistryState,
    scheduler: &SchedulerState,
    extension_id: &str,
) -> Result<(), AppError> {
    let reg = registry.extensions.lock().map_err(|_| AppError::Lock)?;
    let mut tasks = scheduler.tasks.lock().map_err(|_| AppError::Lock)?;

    if let Some(record) = reg.get(extension_id) {
        if !record.enabled {
            return Ok(());
        }
        if record.compatibility != crate::extensions::CompatibilityStatus::Compatible {
            return Ok(());
        }
        for cmd in &record.manifest.commands {
            if let Some(ref schedule) = cmd.schedule {
                if validate_interval(schedule.interval_seconds).is_ok() {
                    let task_key = format!("{}::{}", extension_id, cmd.id);
                    let handle = spawn_timer(
                        app_handle.clone(),
                        extension_id.to_string(),
                        cmd.id.clone(),
                        schedule.interval_seconds,
                    );
                    tasks.insert(task_key, handle);
                    log::info!(
                        "Scheduler: started timer for {}::{} (every {}s)",
                        extension_id,
                        cmd.id,
                        schedule.interval_seconds
                    );
                }
            }
        }
    }
    Ok(())
}

/// Stop all scheduled tasks for a given extension.
pub fn stop_tasks_for_extension(
    scheduler: &SchedulerState,
    extension_id: &str,
) -> Result<(), AppError> {
    let mut tasks = scheduler.tasks.lock().map_err(|_| AppError::Lock)?;
    let prefix = format!("{}::", extension_id);
    let keys_to_remove: Vec<String> = tasks
        .keys()
        .filter(|k| k.starts_with(&prefix))
        .cloned()
        .collect();
    for key in keys_to_remove {
        if let Some(handle) = tasks.remove(&key) {
            handle.abort();
            log::info!("Scheduler: stopped timer for {}", key);
        }
    }
    Ok(())
}

/// Stop ALL scheduled tasks.
pub fn stop_all_tasks(scheduler: &SchedulerState) -> Result<(), AppError> {
    let mut tasks = scheduler.tasks.lock().map_err(|_| AppError::Lock)?;
    for (key, handle) in tasks.drain() {
        handle.abort();
        log::info!("Scheduler: stopped timer for {}", key);
    }
    Ok(())
}

/// Get info about all scheduled tasks for the settings UI.
pub fn get_scheduled_task_info(
    registry: &ExtensionRegistryState,
    scheduler: &SchedulerState,
) -> Result<Vec<ScheduledTaskInfo>, AppError> {
    let reg = registry.extensions.lock().map_err(|_| AppError::Lock)?;
    let tasks = scheduler.tasks.lock().map_err(|_| AppError::Lock)?;
    let mut infos = Vec::new();

    for (ext_id, record) in reg.iter() {
        for cmd in &record.manifest.commands {
            if let Some(ref schedule) = cmd.schedule {
                let task_key = format!("{}::{}", ext_id, cmd.id);
                infos.push(ScheduledTaskInfo {
                    extension_id: ext_id.clone(),
                    extension_name: record.manifest.name.clone(),
                    command_id: cmd.id.clone(),
                    command_name: cmd.name.clone(),
                    interval_seconds: schedule.interval_seconds,
                    active: tasks.contains_key(&task_key),
                });
            }
        }
    }
    Ok(infos)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_interval_below_minimum() {
        assert!(validate_interval(9).is_err());
        assert!(validate_interval(0).is_err());
        assert!(validate_interval(1).is_err());
    }

    #[test]
    fn test_validate_interval_above_maximum() {
        assert!(validate_interval(86401).is_err());
        assert!(validate_interval(100_000).is_err());
    }

    #[test]
    fn test_validate_interval_at_boundaries() {
        assert_eq!(validate_interval(10).unwrap(), 10);
        assert_eq!(validate_interval(86400).unwrap(), 86400);
    }

    #[test]
    fn test_validate_interval_valid() {
        assert_eq!(validate_interval(30).unwrap(), 30);
        assert_eq!(validate_interval(300).unwrap(), 300);
        assert_eq!(validate_interval(3600).unwrap(), 3600);
    }

    #[test]
    fn scheduled_command_message_must_use_command_kind_not_action() {
        // Contract: scheduler ticks are dispatched to extension workers via
        // PendingMessage.kind. The frontend delivery layer maps Action ->
        // 'asyar:action:execute' (looked up by payload.actionId) and Command
        // -> 'asyar:command:execute' (calls extension.executeCommand). Scheduler
        // payloads carry commandId, not actionId, so an Action message would be
        // silently dropped by the SDK's ExtensionBridge actionRegistry lookup.
        // Scheduled ticks MUST be Command.
        let now = std::time::Instant::now();
        let msg = build_scheduled_command_message("tick-test", now);
        assert!(
            matches!(msg.kind, MessageKind::Command),
            "Scheduled commands must dispatch as MessageKind::Command, not Action — \
             Action would be dropped by ExtensionBridge because the scheduler payload \
             carries commandId not actionId"
        );
    }

    #[test]
    fn scheduled_command_payload_must_include_scheduled_tick_flag() {
        // Contract: the scheduler-driven payload must carry args.scheduledTick = true
        // so the SDK worker's recordTick() can distinguish real platform ticks from
        // manual button-press simulations. The view filters its SCHEDULER counter on
        // this flag.
        let now = std::time::Instant::now();
        let msg = build_scheduled_command_message("tick-test", now);
        let scheduled = msg
            .payload
            .get("args")
            .and_then(|a| a.get("scheduledTick"))
            .and_then(|v| v.as_bool());
        assert_eq!(
            scheduled,
            Some(true),
            "payload must include args.scheduledTick = true for the worker's recordTick() to flag it as a scheduler-driven event; got payload={}",
            msg.payload
        );
    }

    #[test]
    fn ready_deliver_now_must_emit_event_deliver_with_messages() {
        // Contract: when enqueue_worker drains the mailbox into ReadyDeliverNow,
        // the scheduler MUST emit EVENT_DELIVER so the TS side can post the
        // drained messages to the worker iframe. Without this emit, every
        // scheduler tick to a Ready worker is silently dropped — the bug that
        // motivated this regression test.
        use crate::extensions::extension_runtime::emitter::RecordingEmitter;
        let emitter = RecordingEmitter::default();
        let now = std::time::Instant::now();
        let msg = build_scheduled_command_message("tick-test", now);
        let outcome = DispatchOutcome::ReadyDeliverNow {
            messages: vec![msg],
        };
        handle_dispatch_outcome(&emitter, "org.asyar.sdk-playground", "tick-test", &outcome);

        let recorded = emitter.events();
        let deliver = recorded
            .iter()
            .find(|(name, _)| name == "asyar:iframe:deliver");
        assert!(
            deliver.is_some(),
            "expected EVENT_DELIVER ('asyar:iframe:deliver') to be emitted on ReadyDeliverNow; got {:?}",
            recorded.iter().map(|(n, _)| n).collect::<Vec<_>>()
        );
        let (_, payload) = deliver.unwrap();
        assert_eq!(
            payload.get("extensionId").and_then(|v| v.as_str()),
            Some("org.asyar.sdk-playground")
        );
        assert_eq!(
            payload.get("role").and_then(|v| v.as_str()),
            Some("worker"),
            "EVENT_DELIVER role must be 'worker' so the TS listener targets the worker iframe (matches ContextRole serialization)"
        );
        let messages = payload.get("messages").and_then(|v| v.as_array());
        assert!(
            messages.is_some(),
            "EVENT_DELIVER payload must include 'messages' array"
        );
        assert_eq!(messages.unwrap().len(), 1);
    }

    #[test]
    fn needs_mount_still_emits_event_mount() {
        // Don't regress the existing NeedsMount behavior while adding ReadyDeliverNow handling.
        use crate::extensions::extension_runtime::emitter::RecordingEmitter;
        let emitter = RecordingEmitter::default();
        let outcome = DispatchOutcome::NeedsMount { mount_token: 42 };
        handle_dispatch_outcome(&emitter, "ext.a", "tick-test", &outcome);

        let recorded = emitter.events();
        assert!(
            recorded.iter().any(|(name, p)| {
                name == "asyar:iframe:mount"
                    && p.get("mountToken").and_then(|v| v.as_u64()) == Some(42)
            }),
            "NeedsMount must still emit EVENT_MOUNT with mountToken={}; got {:?}",
            42,
            recorded
        );
    }
}
