//! Platform-specific notification delivery.
//!
//! The launcher supports two send paths:
//!
//! 1. **No actions** — plain title/body notification. Uses the OS notifier
//!    that's already wired up (osascript in macOS dev, tauri-plugin-notification
//!    on production macOS / Linux / Windows).
//! 2. **With actions** — the platform needs to render clickable buttons
//!    and report which one the user tapped. Tauri's plugin only exposes
//!    action types on mobile, so we drive the underlying libraries
//!    ourselves (`mac-notification-sys` on macOS, `notify-rust`'s xdg
//!    backend on Linux). Windows currently has no action path — the
//!    notification still fires, just without buttons.

use crate::error::AppError;
use crate::notifications::registry::{NotificationActionRegistry, PendingAction};
use std::sync::Arc;

/// Action as seen by the backend — already flattened from the SDK shape,
/// no optional fields. `command_id` + `args_json` are only carried so we
/// can repopulate the registry at send-time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendAction {
    pub id: String,
    pub title: String,
    pub command_id: String,
    pub args_json: Option<String>,
}

impl BackendAction {
    pub fn to_pending(&self, extension_id: &str) -> PendingAction {
        PendingAction {
            extension_id: extension_id.to_string(),
            command_id: self.command_id.clone(),
            args_json: self.args_json.clone(),
        }
    }
}

/// What the TS side ultimately passed to `notifications:send` after the
/// proxy flattened it. `actions` is empty for plain notifications.
#[derive(Debug, Clone)]
pub struct NotificationRequest {
    pub notification_id: String,
    pub title: String,
    pub body: String,
    pub actions: Vec<BackendAction>,
    pub extension_id: String,
}

/// Callback invoked by the backend when the user clicks an action. Kept
/// as a type alias so the production impl (emit Tauri event + remove
/// registry entry) and tests (record clicks in a vector) can share a
/// signature.
pub type ActionClickSink =
    Arc<dyn Fn(&str /* notification_id */, &str /* action_id */) + Send + Sync>;

/// Trait implemented by each OS backend.
pub trait NotificationBackend: Send + Sync {
    /// Fire-and-forget send. The backend owns any threads it spawns for
    /// waiting on user interaction — the caller just returns.
    fn send(&self, request: NotificationRequest) -> Result<(), AppError>;
}

/// Convenience wiring that every backend uses identically — stores the
/// action metadata in the registry, then delegates to the platform send.
pub fn populate_registry_and_send(
    registry: &NotificationActionRegistry,
    backend: &dyn NotificationBackend,
    request: NotificationRequest,
) -> Result<(), AppError> {
    if !request.actions.is_empty() {
        let pairs = request
            .actions
            .iter()
            .map(|a| (a.id.clone(), a.to_pending(&request.extension_id)))
            .collect::<Vec<_>>();
        registry.insert_many(&request.notification_id, pairs);
    }
    backend.send(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct RecordingBackend {
        sent: Mutex<Vec<NotificationRequest>>,
    }

    impl RecordingBackend {
        fn new() -> Arc<Self> {
            Arc::new(Self { sent: Mutex::new(Vec::new()) })
        }
    }

    impl NotificationBackend for RecordingBackend {
        fn send(&self, request: NotificationRequest) -> Result<(), AppError> {
            self.sent.lock().unwrap().push(request);
            Ok(())
        }
    }

    fn req(actions: Vec<BackendAction>) -> NotificationRequest {
        NotificationRequest {
            notification_id: "n-1".to_string(),
            title: "T".to_string(),
            body: "B".to_string(),
            actions,
            extension_id: "ext-a".to_string(),
        }
    }

    fn action(id: &str, cmd: &str) -> BackendAction {
        BackendAction {
            id: id.to_string(),
            title: id.to_string(),
            command_id: cmd.to_string(),
            args_json: None,
        }
    }

    #[test]
    fn populate_and_send_stores_each_action_in_registry() {
        let reg = NotificationActionRegistry::new();
        let be = RecordingBackend::new();
        populate_registry_and_send(
            &reg,
            be.as_ref(),
            req(vec![action("extend", "coffee.extend"), action("stop", "coffee.stop")]),
        )
        .unwrap();

        assert_eq!(reg.lookup("n-1", "extend").unwrap().command_id, "coffee.extend");
        assert_eq!(reg.lookup("n-1", "stop").unwrap().command_id, "coffee.stop");
        assert_eq!(be.sent.lock().unwrap().len(), 1);
    }

    #[test]
    fn populate_and_send_skips_registry_when_no_actions() {
        let reg = NotificationActionRegistry::new();
        let be = RecordingBackend::new();
        populate_registry_and_send(&reg, be.as_ref(), req(vec![])).unwrap();

        assert_eq!(reg.len(), 0);
        assert_eq!(be.sent.lock().unwrap().len(), 1);
    }

    #[test]
    fn to_pending_carries_args_json_through() {
        let a = BackendAction {
            id: "a".to_string(),
            title: "A".to_string(),
            command_id: "cmd".to_string(),
            args_json: Some(r#"{"k":1}"#.to_string()),
        };
        let p = a.to_pending("ext");
        assert_eq!(p.extension_id, "ext");
        assert_eq!(p.command_id, "cmd");
        assert_eq!(p.args_json.as_deref(), Some(r#"{"k":1}"#));
    }
}
