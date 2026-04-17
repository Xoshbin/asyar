//! Tauri command layer for the system-events subscription service.
//!
//! Thin wrappers delegating to pure `*_inner` functions so the logic is unit
//! testable without a running Tauri app.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use crate::system_events::{SystemEventKind, SystemEventsHub};
use std::collections::HashSet;
use std::sync::Arc;
use tauri::State;

const REQUIRED_PERMISSION: &str = "systemEvents:read";

#[tauri::command]
pub fn system_events_subscribe(
    hub: State<'_, Arc<SystemEventsHub>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    event_types: Vec<String>,
) -> Result<String, AppError> {
    system_events_subscribe_inner(&hub, &permissions, extension_id, event_types)
}

#[tauri::command]
pub fn system_events_unsubscribe(
    hub: State<'_, Arc<SystemEventsHub>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    subscription_id: String,
) -> Result<(), AppError> {
    system_events_unsubscribe_inner(&hub, &permissions, extension_id, subscription_id)
}

pub(crate) fn system_events_subscribe_inner(
    hub: &SystemEventsHub,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    event_types: Vec<String>,
) -> Result<String, AppError> {
    permissions.check(&extension_id, REQUIRED_PERMISSION)?;
    let ext = extension_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("extensionId required for subscribe".into()))?;
    let kinds: HashSet<SystemEventKind> = event_types
        .iter()
        .filter_map(|s| SystemEventKind::from_wire(s))
        .collect();
    if kinds.is_empty() {
        return Err(AppError::Validation(
            "at least one valid event type required".into(),
        ));
    }
    hub.subscribe(ext, kinds)
}

pub(crate) fn system_events_unsubscribe_inner(
    hub: &SystemEventsHub,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    subscription_id: String,
) -> Result<(), AppError> {
    permissions.check(&extension_id, REQUIRED_PERMISSION)?;
    let ext = extension_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("extensionId required for unsubscribe".into()))?;
    hub.unsubscribe(ext, &subscription_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet as StdHashSet;

    fn permissions_with(ext_id: &str) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        let mut set = StdHashSet::new();
        set.insert(REQUIRED_PERMISSION.to_string());
        inner.insert(ext_id.to_string(), set);
        drop(inner);
        reg
    }

    fn empty_permissions() -> ExtensionPermissionRegistry {
        ExtensionPermissionRegistry::new()
    }

    #[test]
    fn subscribe_without_permission_is_rejected() {
        let hub = SystemEventsHub::new();
        let perms = empty_permissions();
        let err = system_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["wake".into()],
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn subscribe_with_permission_returns_uuid() {
        let hub = SystemEventsHub::new();
        let perms = permissions_with("ext-a");
        let id = system_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["wake".into(), "sleep".into()],
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn subscribe_with_no_valid_kinds_is_validation_error() {
        let hub = SystemEventsHub::new();
        let perms = permissions_with("ext-a");
        let err = system_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["bogus-kind".into()],
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn subscribe_ignores_unknown_kinds_and_keeps_valid_ones() {
        let hub = SystemEventsHub::new();
        let perms = permissions_with("ext-a");
        let id = system_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["wake".into(), "bogus".into()],
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn unsubscribe_roundtrip() {
        let hub = SystemEventsHub::new();
        let perms = permissions_with("ext-a");
        let id = system_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["wake".into()],
        )
        .unwrap();
        system_events_unsubscribe_inner(&hub, &perms, Some("ext-a".into()), id)
            .expect("unsubscribe ok");
    }

    #[test]
    fn core_caller_still_rejects_without_extension_id() {
        // extension_id = None bypasses permission check but subscribe
        // requires a concrete extension id for the registry key.
        let hub = SystemEventsHub::new();
        let perms = empty_permissions();
        let err =
            system_events_subscribe_inner(&hub, &perms, None, vec!["wake".into()]).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn unsubscribe_unknown_id_returns_not_found() {
        let hub = SystemEventsHub::new();
        let perms = permissions_with("ext-a");
        let err = system_events_unsubscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            "bogus".into(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }
}
