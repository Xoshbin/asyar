//! Extension background scheduler — manages tokio timers for declarative scheduled commands.

use std::collections::HashMap;
use std::sync::Mutex;
use log::warn;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;

use crate::error::AppError;
use super::ExtensionRegistryState;

const MIN_INTERVAL_SECS: u64 = 60;
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

/// Spawn a tokio task that emits scheduler tick events at the given interval.
fn spawn_timer(
    app_handle: AppHandle,
    extension_id: String,
    command_id: String,
    interval_secs: u64,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(
            tokio::time::Duration::from_secs(interval_secs),
        );
        // Skip the first tick (fires immediately by default)
        interval.tick().await;
        loop {
            interval.tick().await;
            let payload = SchedulerTickPayload {
                extension_id: extension_id.clone(),
                command_id: command_id.clone(),
            };
            if let Err(e) = app_handle.emit("asyar:scheduler:tick", &payload) {
                warn!(
                    "Failed to emit scheduler tick for {}::{}: {}",
                    extension_id, command_id, e
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
                        ext_id, cmd.id, schedule.interval_seconds
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
                        extension_id, cmd.id, schedule.interval_seconds
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
        assert!(validate_interval(30).is_err());
        assert!(validate_interval(0).is_err());
        assert!(validate_interval(59).is_err());
    }

    #[test]
    fn test_validate_interval_above_maximum() {
        assert!(validate_interval(86401).is_err());
        assert!(validate_interval(100_000).is_err());
    }

    #[test]
    fn test_validate_interval_at_boundaries() {
        assert_eq!(validate_interval(60).unwrap(), 60);
        assert_eq!(validate_interval(86400).unwrap(), 86400);
    }

    #[test]
    fn test_validate_interval_valid() {
        assert_eq!(validate_interval(300).unwrap(), 300);
        assert_eq!(validate_interval(3600).unwrap(), 3600);
    }
}
