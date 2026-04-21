//! Tauri command layer for the application-index subscription service.
//!
//! Thin wrappers delegating to pure `*_inner` functions so the logic is
//! unit-testable without a running Tauri app.
//!
//! Wire contract (mirrors `commands::app_events`):
//!
//! - `applicationIndex:subscribe` / `applicationIndex:unsubscribe` — on the
//!   dedicated `applicationIndex:*` namespace so the subscription lifecycle
//!   stays distinct from `application:*`'s query surface.
//!
//! Permission: `application:read`. The events carry the same data class as
//! `listApplications`, so the existing permission is the correct gate —
//! granting index-watch doesn't expand what data the extension can see.

use crate::error::AppError;
use crate::index_events::{IndexEventKind, IndexEventsHub};
use crate::permissions::ExtensionPermissionRegistry;
use std::collections::HashSet;
use std::sync::Arc;
use tauri::State;

const APPLICATION_INDEX_PERMISSION: &str = "application:read";

#[tauri::command]
pub fn application_index_subscribe(
    hub: State<'_, Arc<IndexEventsHub>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    event_types: Vec<String>,
) -> Result<String, AppError> {
    application_index_subscribe_inner(&hub, &permissions, extension_id, event_types)
}

#[tauri::command]
pub fn application_index_unsubscribe(
    hub: State<'_, Arc<IndexEventsHub>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    subscription_id: String,
) -> Result<(), AppError> {
    application_index_unsubscribe_inner(&hub, &permissions, extension_id, subscription_id)
}

pub(crate) fn application_index_subscribe_inner(
    hub: &IndexEventsHub,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    event_types: Vec<String>,
) -> Result<String, AppError> {
    permissions.check(&extension_id, APPLICATION_INDEX_PERMISSION)?;
    let ext = extension_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("extensionId required for subscribe".into()))?;
    let kinds: HashSet<IndexEventKind> = event_types
        .iter()
        .filter_map(|s| IndexEventKind::from_wire(s))
        .collect();
    if kinds.is_empty() {
        return Err(AppError::Validation(
            "at least one valid event type required".into(),
        ));
    }
    hub.subscribe(ext, kinds)
}

pub(crate) fn application_index_unsubscribe_inner(
    hub: &IndexEventsHub,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    subscription_id: String,
) -> Result<(), AppError> {
    permissions.check(&extension_id, APPLICATION_INDEX_PERMISSION)?;
    let ext = extension_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("extensionId required for unsubscribe".into()))?;
    hub.unsubscribe(ext, &subscription_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet as StdHashSet;

    fn permissions_with(ext_id: &str, perm: &str) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        let mut set = StdHashSet::new();
        set.insert(perm.to_string());
        inner.insert(ext_id.to_string(), set);
        drop(inner);
        reg
    }

    fn empty_permissions() -> ExtensionPermissionRegistry {
        ExtensionPermissionRegistry::new()
    }

    // ---- subscribe ----

    #[test]
    fn subscribe_without_permission_is_rejected() {
        let hub = IndexEventsHub::new();
        let perms = empty_permissions();
        let err = application_index_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["applications-changed".into()],
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn subscribe_with_permission_returns_uuid() {
        let hub = IndexEventsHub::new();
        let perms = permissions_with("ext-a", APPLICATION_INDEX_PERMISSION);
        let id = application_index_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["applications-changed".into()],
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn subscribe_with_no_valid_kinds_is_validation_error() {
        let hub = IndexEventsHub::new();
        let perms = permissions_with("ext-a", APPLICATION_INDEX_PERMISSION);
        let err = application_index_subscribe_inner(
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
        let hub = IndexEventsHub::new();
        let perms = permissions_with("ext-a", APPLICATION_INDEX_PERMISSION);
        let id = application_index_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["applications-changed".into(), "bogus".into()],
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn core_caller_still_rejects_without_extension_id() {
        let hub = IndexEventsHub::new();
        let perms = empty_permissions();
        let err = application_index_subscribe_inner(
            &hub,
            &perms,
            None,
            vec!["applications-changed".into()],
        )
        .unwrap_err();
        // Core callers with `None` extension_id bypass the permission check
        // (same behavior as app_events), so the error is validation, not
        // permission.
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    // ---- unsubscribe ----

    #[test]
    fn unsubscribe_roundtrip() {
        let hub = IndexEventsHub::new();
        let perms = permissions_with("ext-a", APPLICATION_INDEX_PERMISSION);
        let id = application_index_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["applications-changed".into()],
        )
        .unwrap();
        application_index_unsubscribe_inner(&hub, &perms, Some("ext-a".into()), id)
            .expect("unsubscribe ok");
    }

    #[test]
    fn unsubscribe_without_permission_is_rejected() {
        let hub = IndexEventsHub::new();
        let perms = empty_permissions();
        let err = application_index_unsubscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            "bogus".into(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn unsubscribe_unknown_id_returns_not_found() {
        let hub = IndexEventsHub::new();
        let perms = permissions_with("ext-a", APPLICATION_INDEX_PERMISSION);
        let err = application_index_unsubscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            "bogus".into(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    fn unsubscribe_by_non_owner_is_permission_error() {
        // Both extensions hold application:read. Owner permission is enforced
        // at the hub layer, not via manifest permissions.
        let hub = IndexEventsHub::new();
        let perms = permissions_with("ext-a", APPLICATION_INDEX_PERMISSION);
        {
            let mut inner = perms.inner.lock().unwrap();
            let mut set = StdHashSet::new();
            set.insert(APPLICATION_INDEX_PERMISSION.to_string());
            inner.insert("ext-b".into(), set);
        }
        let id = application_index_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["applications-changed".into()],
        )
        .unwrap();
        let err = application_index_unsubscribe_inner(&hub, &perms, Some("ext-b".into()), id)
            .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }
}
