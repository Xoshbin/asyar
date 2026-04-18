//! Routing logic for OS-reported notification action clicks.
//!
//! This module is intentionally Tauri-free so its behaviour can be
//! exercised without spinning up an app handle. The production emit
//! path that wraps this logic lives in
//! [`super::build_default_backend`] and is exercised end-to-end
//! through the dev-mode playground demo.

use crate::notifications::registry::{NotificationActionRegistry, PendingAction};
use serde::Serialize;

/// Event payload emitted on `asyar:notification-action`.
///
/// Shape is chosen to minimise client-side parsing — the TS bridge can
/// forward the whole payload straight into `handleCommandAction`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationActionEvent {
    pub notification_id: String,
    pub action_id: String,
    pub extension_id: String,
    pub command_id: String,
    /// Serialised JSON object passed through verbatim. `null` when the
    /// action carried no args — distinguishable from `{}` on the TS side.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args_json: Option<String>,
}

/// Pure dispatch: look up the pending action for a click and return the
/// event payload if one is registered.
///
/// The caller is responsible for emission — this separation keeps the
/// logic unit-testable without touching Tauri, and lets the click handler
/// decide whether to also `registry.remove(notification_id)` based on
/// platform semantics (on macOS the dropdown closes the notification;
/// on Linux `wait_for_action` only fires once).
pub fn resolve_click(
    registry: &NotificationActionRegistry,
    notification_id: &str,
    action_id: &str,
) -> Option<NotificationActionEvent> {
    let PendingAction { extension_id, command_id, args_json } =
        registry.lookup(notification_id, action_id)?;
    Some(NotificationActionEvent {
        notification_id: notification_id.to_string(),
        action_id: action_id.to_string(),
        extension_id,
        command_id,
        args_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending(ext: &str, cmd: &str, args: Option<&str>) -> PendingAction {
        PendingAction {
            extension_id: ext.to_string(),
            command_id: cmd.to_string(),
            args_json: args.map(|s| s.to_string()),
        }
    }

    #[test]
    fn resolve_known_click_returns_event_with_command_target() {
        let registry = NotificationActionRegistry::new();
        registry.insert_many(
            "notif-1",
            vec![("extend".to_string(), pending("coffee", "coffee.extend", Some(r#"{"minutes":30}"#)))],
        );

        let ev = resolve_click(&registry, "notif-1", "extend").expect("should resolve");

        assert_eq!(
            ev,
            NotificationActionEvent {
                notification_id: "notif-1".to_string(),
                action_id: "extend".to_string(),
                extension_id: "coffee".to_string(),
                command_id: "coffee.extend".to_string(),
                args_json: Some(r#"{"minutes":30}"#.to_string()),
            }
        );
    }

    #[test]
    fn resolve_unknown_click_returns_none() {
        let registry = NotificationActionRegistry::new();
        registry.insert_many("n", vec![("a".to_string(), pending("ext", "cmd", None))]);

        assert!(resolve_click(&registry, "other", "a").is_none());
        assert!(resolve_click(&registry, "n", "other").is_none());
    }

    #[test]
    fn resolve_after_extension_uninstall_returns_none() {
        let registry = NotificationActionRegistry::new();
        registry.insert_many("n", vec![("a".to_string(), pending("uninst", "cmd", None))]);
        registry.remove_all_for_extension("uninst");

        assert!(resolve_click(&registry, "n", "a").is_none());
    }

    #[test]
    fn event_serialises_with_camelcase_fields() {
        let ev = NotificationActionEvent {
            notification_id: "n".to_string(),
            action_id: "a".to_string(),
            extension_id: "e".to_string(),
            command_id: "c".to_string(),
            args_json: Some("{}".to_string()),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert!(v.get("notificationId").is_some());
        assert!(v.get("actionId").is_some());
        assert!(v.get("extensionId").is_some());
        assert!(v.get("commandId").is_some());
        assert!(v.get("argsJson").is_some());
    }

    #[test]
    fn event_omits_args_json_when_none() {
        let ev = NotificationActionEvent {
            notification_id: "n".to_string(),
            action_id: "a".to_string(),
            extension_id: "e".to_string(),
            command_id: "c".to_string(),
            args_json: None,
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert!(v.get("argsJson").is_none());
    }
}
