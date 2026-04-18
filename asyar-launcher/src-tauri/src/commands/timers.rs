//! Tauri command layer for the one-shot timer registry.
//!
//! Thin wrappers delegate to pure `*_inner` functions so the logic is unit-
//! testable without a running Tauri app. Mirrors `commands/power.rs`.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use crate::shell::now_millis;
use crate::timers::{TimerDescriptor, TimerRegistry};
use tauri::State;

const PERM_SCHEDULE: &str = "timers:schedule";
const PERM_CANCEL: &str = "timers:cancel";
const PERM_LIST: &str = "timers:list";

#[tauri::command]
pub fn timer_schedule(
    registry: State<'_, TimerRegistry>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    command_id: String,
    args_json: String,
    fire_at: u64,
) -> Result<String, AppError> {
    timer_schedule_inner(
        &registry,
        &permissions,
        extension_id,
        command_id,
        args_json,
        fire_at,
        now_millis(),
    )
}

#[tauri::command]
pub fn timer_cancel(
    registry: State<'_, TimerRegistry>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    timer_id: String,
) -> Result<(), AppError> {
    timer_cancel_inner(&registry, &permissions, extension_id, timer_id)
}

#[tauri::command]
pub fn timer_list(
    registry: State<'_, TimerRegistry>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
) -> Result<Vec<TimerDescriptor>, AppError> {
    timer_list_inner(&registry, &permissions, extension_id)
}

pub(crate) fn timer_schedule_inner(
    registry: &TimerRegistry,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    command_id: String,
    args_json: String,
    fire_at: u64,
    now_ms: u64,
) -> Result<String, AppError> {
    permissions.check(&extension_id, PERM_SCHEDULE)?;
    // Core callers (extension_id = None) can't own a timer — a fired event
    // has no iframe to dispatch to. Reject early rather than persist an
    // orphaned row.
    let ext = extension_id
        .ok_or_else(|| AppError::Validation("timer_schedule requires an extensionId".to_string()))?;
    registry.schedule(&ext, &command_id, &args_json, fire_at, now_ms)
}

pub(crate) fn timer_cancel_inner(
    registry: &TimerRegistry,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    timer_id: String,
) -> Result<(), AppError> {
    permissions.check(&extension_id, PERM_CANCEL)?;
    let ext = extension_id
        .ok_or_else(|| AppError::Validation("timer_cancel requires an extensionId".to_string()))?;
    registry.cancel(&ext, &timer_id)
}

pub(crate) fn timer_list_inner(
    registry: &TimerRegistry,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
) -> Result<Vec<TimerDescriptor>, AppError> {
    permissions.check(&extension_id, PERM_LIST)?;
    let ext = extension_id
        .ok_or_else(|| AppError::Validation("timer_list requires an extensionId".to_string()))?;
    registry.list_pending(&ext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn grant(ext: &str, perms: &[&str]) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        {
            let mut inner = reg.inner.lock().unwrap();
            let mut set = HashSet::new();
            for p in perms {
                set.insert(p.to_string());
            }
            inner.insert(ext.to_string(), set);
        }
        reg
    }

    #[test]
    fn schedule_without_permission_rejected() {
        let r = TimerRegistry::in_memory();
        let p = grant("ext-a", &[]);
        let err = timer_schedule_inner(
            &r,
            &p,
            Some("ext-a".into()),
            "cmd".into(),
            "{}".into(),
            2_000,
            1_000,
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn schedule_without_extension_id_rejected() {
        let r = TimerRegistry::in_memory();
        let p = grant("ext-a", &[PERM_SCHEDULE]);
        // Core caller (None) is allowed by perms check but rejected with
        // Validation because there's no iframe to dispatch into.
        let err = timer_schedule_inner(
            &r,
            &p,
            None,
            "cmd".into(),
            "{}".into(),
            2_000,
            1_000,
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn schedule_with_permission_persists_row_and_returns_uuid() {
        let r = TimerRegistry::in_memory();
        let p = grant("ext-a", &[PERM_SCHEDULE, PERM_LIST]);
        let id = timer_schedule_inner(
            &r,
            &p,
            Some("ext-a".into()),
            "cmd".into(),
            "{}".into(),
            2_000,
            1_000,
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
        let list =
            timer_list_inner(&r, &p, Some("ext-a".into())).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].timer_id, id);
    }

    #[test]
    fn cancel_without_permission_rejected() {
        let r = TimerRegistry::in_memory();
        let p = grant("ext-a", &[PERM_SCHEDULE]);
        let id = timer_schedule_inner(
            &r,
            &p,
            Some("ext-a".into()),
            "cmd".into(),
            "{}".into(),
            2_000,
            1_000,
        )
        .unwrap();
        // Take permission away for cancel
        let p2 = grant("ext-a", &[]);
        let err = timer_cancel_inner(&r, &p2, Some("ext-a".into()), id).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn cancel_of_own_timer_succeeds() {
        let r = TimerRegistry::in_memory();
        let p = grant("ext-a", &[PERM_SCHEDULE, PERM_CANCEL, PERM_LIST]);
        let id = timer_schedule_inner(
            &r,
            &p,
            Some("ext-a".into()),
            "cmd".into(),
            "{}".into(),
            2_000,
            1_000,
        )
        .unwrap();
        timer_cancel_inner(&r, &p, Some("ext-a".into()), id).unwrap();
        assert!(timer_list_inner(&r, &p, Some("ext-a".into()))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn list_without_permission_rejected() {
        let r = TimerRegistry::in_memory();
        let p = grant("ext-a", &[]);
        let err =
            timer_list_inner(&r, &p, Some("ext-a".into())).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn list_returns_only_callers_pending_timers() {
        let r = TimerRegistry::in_memory();
        let p_a = grant("ext-a", &[PERM_SCHEDULE, PERM_LIST]);
        let p_b = grant("ext-b", &[PERM_SCHEDULE, PERM_LIST]);
        let _ = timer_schedule_inner(
            &r,
            &p_a,
            Some("ext-a".into()),
            "cmd".into(),
            "{}".into(),
            2_000,
            1_000,
        )
        .unwrap();
        let _ = timer_schedule_inner(
            &r,
            &p_b,
            Some("ext-b".into()),
            "cmd".into(),
            "{}".into(),
            3_000,
            1_000,
        )
        .unwrap();
        let list_a = timer_list_inner(&r, &p_a, Some("ext-a".into())).unwrap();
        assert_eq!(list_a.len(), 1);
        assert_eq!(list_a[0].extension_id, "ext-a");
    }
}
