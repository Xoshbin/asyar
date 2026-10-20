//! System integration commands.
//!
//! Manages autostart, outbound HTTP requests, and a few miscellaneous
//! platform integrations. Notifications moved to `crate::notifications`.

use crate::error::AppError;
use crate::storage::DataStore;
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

fn build_lan_policy(
    registry: &crate::permissions::ExtensionPermissionRegistry,
    store: &DataStore,
    extension_id: Option<&str>,
) -> Result<Option<crate::network::lan_policy::LanPolicy>, AppError> {
    let Some(id) = extension_id else {
        return Ok(None);
    };
    let Some(mut policy) = registry.lan_policy_manifest(id)? else {
        return Ok(None);
    };
    let conn = store.conn()?;
    let user_hosts = crate::storage::lan_allowed_hosts::list(&conn, id)?;
    policy.merge_user_hosts(&user_hosts);
    Ok(Some(policy))
}

/// Performs an outbound HTTP request and returns the JSON response body.
/// Thin wrapper: enforces the per-extension `network` permission and the
/// SSRF guard, then delegates to `network::service::fetch`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fetch_url(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    caller_extension_id: Option<String>,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    store: tauri::State<'_, DataStore>,
) -> Result<serde_json::Value, AppError> {
    registry.check(&caller_extension_id, "network")?;
    let lan_policy = build_lan_policy(&registry, &store, caller_extension_id.as_deref())?;

    crate::network::service::fetch_scoped(
        crate::network::service::FetchRequest {
            url,
            method,
            headers,
            body,
            timeout_ms,
        },
        lan_policy.as_ref(),
        caller_extension_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn ws_connect(
    request: WebSocketConnectRequest,
    registry: tauri::State<'_, crate::permissions::ExtensionPermissionRegistry>,
    store: tauri::State<'_, DataStore>,
    ws_manager: tauri::State<'_, crate::network::websocket::WebSocketManager>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    registry.check(&request.caller_extension_id, "network")?;
    let lan_policy = build_lan_policy(&registry, &store, request.caller_extension_id.as_deref())?;
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
            lan_policy.as_ref(),
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

#[cfg(test)]
mod lan_policy_tests {
    use super::*;
    use crate::{permissions::ExtensionPermissionRegistry, storage::DataStore};

    fn make_registry_with_lan() -> ExtensionPermissionRegistry {
        let r = ExtensionPermissionRegistry::new();
        r.register(
            "org.test",
            std::collections::HashSet::from(["network".to_string(), "network:lan".to_string()]),
            std::collections::HashMap::new(),
        );
        r
    }

    #[test]
    fn bare_lan_extension_with_no_user_hosts_returns_empty_policy() {
        let registry = make_registry_with_lan();
        let store = DataStore::in_memory().unwrap();
        let policy = build_lan_policy(&registry, &store, Some("org.test"))
            .expect("build must succeed")
            .expect("bare lan extension must return Some policy");
        let err = policy.authorize(
            "192.168.1.50",
            8123,
            &[std::net::IpAddr::V4(std::net::Ipv4Addr::new(
                192, 168, 1, 50,
            ))],
        );
        assert!(err.is_err(), "empty policy must deny");
    }

    #[test]
    fn extension_without_lan_permission_returns_none() {
        let r = ExtensionPermissionRegistry::new();
        r.register(
            "org.nolan",
            std::collections::HashSet::from(["network".to_string()]),
            std::collections::HashMap::new(),
        );
        let store = DataStore::in_memory().unwrap();
        let policy = build_lan_policy(&r, &store, Some("org.nolan")).unwrap();
        assert!(policy.is_none());
    }

    #[test]
    fn user_host_added_to_store_is_reflected_in_policy() {
        let registry = make_registry_with_lan();
        let store = DataStore::in_memory().unwrap();
        {
            let conn = store.conn().unwrap();
            crate::storage::lan_allowed_hosts::init_table(&conn).unwrap();
            crate::storage::lan_allowed_hosts::add(&conn, "org.test", "ha.local", 8123, "HA")
                .unwrap();
        }
        let policy = build_lan_policy(&registry, &store, Some("org.test"))
            .unwrap()
            .unwrap();
        assert!(policy
            .authorize(
                "ha.local",
                8123,
                &[std::net::IpAddr::V4(std::net::Ipv4Addr::new(
                    192, 168, 1, 50
                ))]
            )
            .is_ok());
        assert!(policy
            .authorize(
                "ha.local",
                9999,
                &[std::net::IpAddr::V4(std::net::Ipv4Addr::new(
                    192, 168, 1, 50
                ))]
            )
            .is_err());
    }
}
