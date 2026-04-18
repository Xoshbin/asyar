//! Tauri commands bridging the TS `notifications:*` IPC into the Rust
//! backend. The router in `ExtensionIpcRouter.ts` resolves these via the
//! `notificationService` on the TS side, which just proxies through to
//! these handlers.

use crate::error::AppError;
use crate::notifications::backend::{
    populate_registry_and_send, BackendAction, NotificationBackend, NotificationRequest,
};
use crate::notifications::registry::NotificationActionRegistry;
use serde::Deserialize;
use tauri::Runtime;
use uuid::Uuid;

/// Wire shape coming in from the TS `NotificationServiceProxy.send()`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionInput {
    pub id: String,
    pub title: String,
    pub command_id: String,
    #[serde(default)]
    pub args: Option<serde_json::Value>,
}

/// Tauri command handler for `notifications:send`.
///
/// Returns the generated notification id back to the caller so they can
/// `dismiss()` it later.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn send_notification<R: Runtime>(
    app: tauri::AppHandle<R>,
    title: String,
    #[allow(non_snake_case)] body: Option<String>,
    #[allow(non_snake_case)] actions: Option<Vec<ActionInput>>,
    #[allow(non_snake_case)] callerExtensionId: Option<String>,
    permission_registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    registry: tauri::State<'_, std::sync::Arc<NotificationActionRegistry>>,
    backend: tauri::State<'_, std::sync::Arc<dyn NotificationBackend>>,
) -> Result<String, AppError> {
    let _ = &app;
    permission_registry.check(&callerExtensionId, "notifications:send")?;

    let extension_id = callerExtensionId.unwrap_or_default();
    let notification_id = format!("notif_{}", Uuid::new_v4());

    let backend_actions = match actions {
        Some(v) => validate_and_flatten(&v)?,
        None => Vec::new(),
    };

    let request = NotificationRequest {
        notification_id: notification_id.clone(),
        title,
        body: body.unwrap_or_default(),
        actions: backend_actions,
        extension_id,
    };

    populate_registry_and_send(registry.inner(), backend.inner().as_ref(), request)?;
    Ok(notification_id)
}

/// Tauri command handler for `notifications:dismiss`.
#[tauri::command]
pub fn dismiss_notification(
    #[allow(non_snake_case)] notificationId: String,
    #[allow(non_snake_case)] callerExtensionId: Option<String>,
    permission_registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    registry: tauri::State<'_, std::sync::Arc<NotificationActionRegistry>>,
) -> Result<(), AppError> {
    permission_registry.check(&callerExtensionId, "notifications:send")?;
    registry.remove(&notificationId);
    Ok(())
}

pub fn validate_and_flatten(inputs: &[ActionInput]) -> Result<Vec<BackendAction>, AppError> {
    inputs
        .iter()
        .map(|a| {
            if a.id.is_empty() {
                return Err(AppError::Validation("notification action missing id".into()));
            }
            if a.title.is_empty() {
                return Err(AppError::Validation(format!(
                    "notification action '{}' missing title",
                    a.id
                )));
            }
            if a.command_id.is_empty() {
                return Err(AppError::Validation(format!(
                    "notification action '{}' missing commandId",
                    a.id
                )));
            }
            let args_json = match &a.args {
                Some(v) => Some(serde_json::to_string(v)?),
                None => None,
            };
            Ok(BackendAction {
                id: a.id.clone(),
                title: a.title.clone(),
                command_id: a.command_id.clone(),
                args_json,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: &str, title: &str, cmd: &str, args: Option<serde_json::Value>) -> ActionInput {
        ActionInput {
            id: id.to_string(),
            title: title.to_string(),
            command_id: cmd.to_string(),
            args,
        }
    }

    #[test]
    fn flattens_valid_actions_and_serialises_args() {
        let out = validate_and_flatten(&[
            input("extend", "Extend", "coffee.extend", Some(serde_json::json!({"minutes": 30}))),
            input("stop", "Stop", "coffee.stop", None),
        ])
        .unwrap();

        assert_eq!(out.len(), 2);
        assert_eq!(out[0].id, "extend");
        assert_eq!(out[0].args_json.as_deref(), Some(r#"{"minutes":30}"#));
        assert_eq!(out[1].args_json, None);
    }

    #[test]
    fn rejects_action_missing_id() {
        let err = validate_and_flatten(&[input("", "Extend", "coffee.extend", None)]).unwrap_err();
        assert!(err.to_string().contains("missing id"));
    }

    #[test]
    fn rejects_action_missing_title() {
        let err = validate_and_flatten(&[input("a", "", "cmd", None)]).unwrap_err();
        assert!(err.to_string().contains("missing title"));
    }

    #[test]
    fn rejects_action_missing_command_id() {
        let err = validate_and_flatten(&[input("a", "T", "", None)]).unwrap_err();
        assert!(err.to_string().contains("missing commandId"));
    }
}
