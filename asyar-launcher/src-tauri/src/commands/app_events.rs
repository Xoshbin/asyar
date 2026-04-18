//! Tauri command layer for the app-events subscription service + the
//! synchronous `application:isRunning` query.
//!
//! Thin wrappers delegating to pure `*_inner` functions so the logic is
//! unit-testable without a running Tauri app.
//!
//! Namespace split (mirrored on the SDK side):
//!
//! - `application:isRunning` — lives on the existing `application:*`
//!   namespace because it's a one-shot query like the rest of
//!   `ApplicationService`.
//! - `appEvents:subscribe` / `appEvents:unsubscribe` — on a dedicated
//!   `appEvents:*` namespace so the subscription lifecycle stays distinct
//!   from application's query-only calls and maps cleanly onto the
//!   `app:frontmost-watch` permission.

use crate::app_events::{AppEventKind, AppEventsHub, AppPresenceQuery};
use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use std::collections::HashSet;
use std::sync::Arc;
use tauri::State;

const APP_EVENTS_PERMISSION: &str = "app:frontmost-watch";
const APP_IS_RUNNING_PERMISSION: &str = "application:read";

#[tauri::command]
pub fn app_events_subscribe(
    hub: State<'_, Arc<AppEventsHub>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    event_types: Vec<String>,
) -> Result<String, AppError> {
    app_events_subscribe_inner(&hub, &permissions, extension_id, event_types)
}

#[tauri::command]
pub fn app_events_unsubscribe(
    hub: State<'_, Arc<AppEventsHub>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    subscription_id: String,
) -> Result<(), AppError> {
    app_events_unsubscribe_inner(&hub, &permissions, extension_id, subscription_id)
}

#[tauri::command]
pub fn app_is_running(
    query: State<'_, Arc<dyn AppPresenceQuery>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    bundle_id: String,
) -> Result<bool, AppError> {
    app_is_running_inner(query.inner().as_ref(), &permissions, extension_id, bundle_id)
}

pub(crate) fn app_events_subscribe_inner(
    hub: &AppEventsHub,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    event_types: Vec<String>,
) -> Result<String, AppError> {
    permissions.check(&extension_id, APP_EVENTS_PERMISSION)?;
    let ext = extension_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("extensionId required for subscribe".into()))?;
    let kinds: HashSet<AppEventKind> = event_types
        .iter()
        .filter_map(|s| AppEventKind::from_wire(s))
        .collect();
    if kinds.is_empty() {
        return Err(AppError::Validation(
            "at least one valid event type required".into(),
        ));
    }
    hub.subscribe(ext, kinds)
}

pub(crate) fn app_events_unsubscribe_inner(
    hub: &AppEventsHub,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    subscription_id: String,
) -> Result<(), AppError> {
    permissions.check(&extension_id, APP_EVENTS_PERMISSION)?;
    let ext = extension_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("extensionId required for unsubscribe".into()))?;
    hub.unsubscribe(ext, &subscription_id)
}

pub(crate) fn app_is_running_inner(
    query: &dyn AppPresenceQuery,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    bundle_id: String,
) -> Result<bool, AppError> {
    permissions.check(&extension_id, APP_IS_RUNNING_PERMISSION)?;
    if bundle_id.trim().is_empty() {
        return Err(AppError::Validation("bundleId must be non-empty".into()));
    }
    Ok(query.is_running(&bundle_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_events::fake::FakePresenceQuery;
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
        let hub = AppEventsHub::new();
        let perms = empty_permissions();
        let err = app_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["launched".into()],
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn subscribe_with_permission_returns_uuid() {
        let hub = AppEventsHub::new();
        let perms = permissions_with("ext-a", APP_EVENTS_PERMISSION);
        let id = app_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["launched".into(), "terminated".into()],
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn subscribe_wrong_permission_is_rejected() {
        let hub = AppEventsHub::new();
        // Holds application:read but NOT app:frontmost-watch.
        let perms = permissions_with("ext-a", APP_IS_RUNNING_PERMISSION);
        let err = app_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["launched".into()],
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn subscribe_with_no_valid_kinds_is_validation_error() {
        let hub = AppEventsHub::new();
        let perms = permissions_with("ext-a", APP_EVENTS_PERMISSION);
        let err = app_events_subscribe_inner(
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
        let hub = AppEventsHub::new();
        let perms = permissions_with("ext-a", APP_EVENTS_PERMISSION);
        let id = app_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["launched".into(), "bogus".into()],
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn subscribe_accepts_all_three_kinds() {
        let hub = AppEventsHub::new();
        let perms = permissions_with("ext-a", APP_EVENTS_PERMISSION);
        let id = app_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec![
                "launched".into(),
                "terminated".into(),
                "frontmost-changed".into(),
            ],
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn core_caller_still_rejects_without_extension_id() {
        let hub = AppEventsHub::new();
        let perms = empty_permissions();
        let err =
            app_events_subscribe_inner(&hub, &perms, None, vec!["launched".into()]).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    // ---- unsubscribe ----

    #[test]
    fn unsubscribe_roundtrip() {
        let hub = AppEventsHub::new();
        let perms = permissions_with("ext-a", APP_EVENTS_PERMISSION);
        let id = app_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["launched".into()],
        )
        .unwrap();
        app_events_unsubscribe_inner(&hub, &perms, Some("ext-a".into()), id)
            .expect("unsubscribe ok");
    }

    #[test]
    fn unsubscribe_without_permission_is_rejected() {
        let hub = AppEventsHub::new();
        let perms = empty_permissions();
        let err = app_events_unsubscribe_inner(
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
        let hub = AppEventsHub::new();
        let perms = permissions_with("ext-a", APP_EVENTS_PERMISSION);
        let err = app_events_unsubscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            "bogus".into(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    // ---- is_running ----

    #[test]
    fn is_running_without_permission_is_rejected() {
        let q = FakePresenceQuery::default();
        let perms = empty_permissions();
        let err = app_is_running_inner(
            &q,
            &perms,
            Some("ext-a".into()),
            "com.apple.Safari".into(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn is_running_reports_true_when_bundle_matches() {
        let q = FakePresenceQuery::with_running(["com.apple.Safari"]);
        let perms = permissions_with("ext-a", APP_IS_RUNNING_PERMISSION);
        let result = app_is_running_inner(
            &q,
            &perms,
            Some("ext-a".into()),
            "com.apple.Safari".into(),
        )
        .unwrap();
        assert!(result);
    }

    #[test]
    fn is_running_reports_false_when_bundle_missing() {
        let q = FakePresenceQuery::with_running(["com.apple.Safari"]);
        let perms = permissions_with("ext-a", APP_IS_RUNNING_PERMISSION);
        let result = app_is_running_inner(
            &q,
            &perms,
            Some("ext-a".into()),
            "com.nope.NotHere".into(),
        )
        .unwrap();
        assert!(!result);
    }

    #[test]
    fn is_running_with_empty_bundle_is_validation_error() {
        let q = FakePresenceQuery::default();
        let perms = permissions_with("ext-a", APP_IS_RUNNING_PERMISSION);
        let err =
            app_is_running_inner(&q, &perms, Some("ext-a".into()), "   ".into()).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn is_running_core_caller_allowed_without_permission() {
        // extension_id = None bypasses permission check for core callers.
        let q = FakePresenceQuery::with_running(["com.test"]);
        let perms = empty_permissions();
        let result = app_is_running_inner(&q, &perms, None, "com.test".into()).unwrap();
        assert!(result);
    }
}
