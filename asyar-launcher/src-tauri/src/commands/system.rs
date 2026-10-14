//! System integration commands.
//!
//! Manages autostart, outbound HTTP requests, and a few miscellaneous
//! platform integrations. Notifications moved to `crate::notifications`.

use crate::error::AppError;
use log::info;
use std::collections::HashMap;
use tauri::AppHandle;

pub(crate) async fn fetch_url_with_secrets_inner(
    registry: &crate::permissions::ExtensionPermissionRegistry,
    caller_extension_id: Option<String>,
    secret_refs: Vec<String>,
    request: crate::network::service::FetchRequest,
    env: &crate::network::secret_refs::SecretEnv,
) -> Result<serde_json::Value, AppError> {
    let caller = require_secret_caller(&caller_extension_id)?;
    registry.check(&caller_extension_id, "network")?;
    registry.check(&caller_extension_id, "network:secrets")?;
    let decls = registry.secret_refs(caller)?;
    crate::network::secret_refs::fetch_with_secrets(&decls, &secret_refs, request, env).await
}

fn require_secret_caller(caller: &Option<String>) -> Result<&str, AppError> {
    caller
        .as_deref()
        .filter(|id| !id.is_empty() && *id != "asyar")
        .ok_or_else(|| AppError::Permission("Secret requests require an extension caller".into()))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Keep the existing fetch_url wire arguments, plus secret_refs.
pub async fn fetch_url_with_secrets(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    secret_refs: Vec<String>,
    caller_extension_id: Option<String>,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, AppError> {
    let caller = require_secret_caller(&caller_extension_id)?.to_string();
    let (home, extra) = super::files::extension_scope_env(&app_handle)?;
    let env = crate::network::secret_refs::SecretEnv::new(
        home,
        extra,
        caller,
        registry.secret_runtime.clone(),
    );
    fetch_url_with_secrets_inner(
        &registry,
        caller_extension_id,
        secret_refs,
        crate::network::service::FetchRequest {
            url,
            method,
            headers,
            body,
            timeout_ms,
        },
        &env,
    )
    .await
}

#[cfg(test)]
mod secret_tests {
    use super::*;
    use crate::{
        network::{secret_refs::SecretEnv, service::FetchRequest},
        permissions::ExtensionPermissionRegistry,
    };
    fn request() -> FetchRequest {
        FetchRequest {
            url: "https://api.example.com".into(),
            method: None,
            headers: None,
            body: None,
            timeout_ms: None,
        }
    }
    #[tokio::test]
    async fn fetch_url_with_secrets_rejects_none_and_asyar_caller() {
        let r = ExtensionPermissionRegistry::new();
        let env = SecretEnv::insecure_for_tests();
        for caller in [None, Some("asyar".into())] {
            assert!(fetch_url_with_secrets_inner(
                &r,
                caller,
                vec!["token".into()],
                request(),
                &env
            )
            .await
            .unwrap_err()
            .to_string()
            .contains("extension caller"));
        }
    }
    #[tokio::test]
    async fn requires_both_network_and_network_secrets() {
        let r = ExtensionPermissionRegistry::new();
        let env = SecretEnv::insecure_for_tests();
        for permission in ["network", "network:secrets"] {
            r.register(
                "test",
                std::collections::HashSet::from([permission.into()]),
                HashMap::new(),
            );
            let e = fetch_url_with_secrets_inner(
                &r,
                Some("test".into()),
                vec!["token".into()],
                request(),
                &env,
            )
            .await
            .unwrap_err();
            assert!(e.to_string().contains("requires"), "{e}");
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSocketConnectRequest {
    socket_id: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    caller_extension_id: Option<String>,
    origin_role: Option<String>,
}

/// Enables or disables launching Asyar at login (autostart).
#[tauri::command]
pub async fn initialize_autostart_from_settings(
    app_handle: AppHandle,
    enable: bool,
) -> Result<(), AppError> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;

        let autostart_manager = app_handle.autolaunch();
        let current_status = autostart_manager.is_enabled().unwrap_or(false);

        info!(
            "Initializing autostart: should be {}, currently {}",
            enable, current_status
        );

        if enable && !current_status {
            autostart_manager
                .enable()
                .map_err(|e| AppError::Platform(format!("Failed to enable autostart: {}", e)))?;
        } else if !enable && current_status {
            autostart_manager
                .disable()
                .map_err(|e| AppError::Platform(format!("Failed to disable autostart: {}", e)))?;
        }

        // Verify the change was successful
        let new_status = autostart_manager.is_enabled().unwrap_or(false);
        if new_status != enable {
            return Err(AppError::Platform(format!(
                "Failed to set autostart: expected {}, got {}",
                enable, new_status
            )));
        }
    }

    Ok(())
}

/// Returns `true` if Asyar is configured to launch at login.
#[tauri::command]
pub async fn get_autostart_status(app_handle: AppHandle) -> Result<bool, AppError> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;

        let autostart_manager = app_handle.autolaunch();
        match autostart_manager.is_enabled() {
            Ok(enabled) => Ok(enabled),
            Err(e) => Err(AppError::Platform(format!(
                "Failed to get autostart status: {}",
                e
            ))),
        }
    }

    #[cfg(not(desktop))]
    {
        let _ = app_handle;
        return Ok(false);
    }
}

/// Performs an outbound HTTP request and returns the JSON response body.
/// Thin wrapper: enforces the per-extension `network` permission and the
/// SSRF guard, then delegates to `network::service::fetch`.
#[tauri::command]
pub async fn fetch_url(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    caller_extension_id: Option<String>,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
) -> Result<serde_json::Value, AppError> {
    registry.check(&caller_extension_id, "network")?;
    let lan_policy = caller_extension_id
        .as_deref()
        .map(|extension_id| registry.lan_policy(extension_id))
        .transpose()?
        .flatten();

    crate::network::service::fetch_scoped(
        crate::network::service::FetchRequest {
            url,
            method,
            headers,
            body,
            timeout_ms,
        },
        lan_policy.as_ref(),
    )
    .await
}

#[tauri::command]
pub async fn ws_connect(
    request: WebSocketConnectRequest,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    ws_manager: tauri::State<'_, crate::network::websocket::WebSocketManager>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    registry.check(&request.caller_extension_id, "network")?;
    let ext_id = request
        .caller_extension_id
        .unwrap_or_else(|| "system".to_string());
    let origin_role = request
        .origin_role
        .filter(|role| matches!(role.as_str(), "view" | "worker"))
        .ok_or_else(|| {
            AppError::Other(
                "WebSocket connections must originate from a view or worker iframe".to_string(),
            )
        })?;
    ws_manager
        .connect(
            request.socket_id,
            request.url,
            request.headers,
            ext_id,
            origin_role,
            app,
        )
        .await
}

#[tauri::command]
pub async fn ws_send(
    socket_id: String,
    message: String,
    caller_extension_id: Option<String>,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    ws_manager: tauri::State<'_, crate::network::websocket::WebSocketManager>,
) -> Result<(), AppError> {
    registry.check(&caller_extension_id, "network")?;
    let ext_id = caller_extension_id.unwrap_or_else(|| "system".to_string());
    ws_manager.send(&socket_id, message, &ext_id)
}

#[tauri::command]
pub async fn ws_close(
    socket_id: String,
    code: Option<u16>,
    reason: Option<String>,
    caller_extension_id: Option<String>,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    ws_manager: tauri::State<'_, crate::network::websocket::WebSocketManager>,
) -> Result<(), AppError> {
    registry.check(&caller_extension_id, "network")?;
    let ext_id = caller_extension_id.unwrap_or_else(|| "system".to_string());
    ws_manager.close(&socket_id, code, reason, &ext_id).await
}
