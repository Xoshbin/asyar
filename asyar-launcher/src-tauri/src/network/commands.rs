use crate::error::AppError;
use crate::network::discovery::DiscoveredDevice;
use crate::storage::lan_allowed_hosts::{self, LanAllowedHost};
use crate::storage::DataStore;
use tauri::State;

/// List user-approved LAN hosts for an extension.
/// Called only from the Settings window (trusted Tauri window).
#[tauri::command]
pub async fn lan_hosts_list(
    extension_id: String,
    store: State<'_, DataStore>,
) -> Result<Vec<LanAllowedHost>, AppError> {
    let conn = store.conn()?;
    Ok(lan_allowed_hosts::list(&conn, &extension_id)?)
}

/// Add a user-approved LAN host after validating with LanPolicy::from_manifest.
#[tauri::command]
pub async fn lan_hosts_add(
    extension_id: String,
    host: String,
    port: u16,
    label: String,
    store: State<'_, DataStore>,
) -> Result<LanAllowedHost, AppError> {
    crate::network::lan_policy::LanPolicy::from_manifest(Some(&serde_json::json!([format!(
        "{host}:{port}"
    )])))?;
    let conn = store.conn()?;
    Ok(lan_allowed_hosts::add(
        &conn,
        &extension_id,
        &host,
        port,
        &label,
    )?)
}

/// Remove a user-approved LAN host.
#[tauri::command]
pub async fn lan_hosts_remove(
    extension_id: String,
    host: String,
    port: u16,
    store: State<'_, DataStore>,
) -> Result<bool, AppError> {
    let conn = store.conn()?;
    Ok(lan_allowed_hosts::remove(
        &conn,
        &extension_id,
        &host,
        port,
    )?)
}

/// Scan for LAN devices via SSDP and mDNS concurrently (3-second timeout).
/// Settings-window only — must NOT be reachable by extensions.
#[tauri::command]
pub async fn scan_lan_devices() -> Result<Vec<DiscoveredDevice>, AppError> {
    crate::network::discovery::scan(3).await
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn add_valid_hostname_succeeds() {
        let result =
            crate::network::lan_policy::LanPolicy::from_manifest(Some(&serde_json::json!([
                "ha.local:8123"
            ])));
        assert!(result.is_ok(), "ha.local:8123 must be a valid LAN endpoint");
    }

    #[tokio::test]
    async fn add_loopback_is_rejected_by_validation() {
        let result =
            crate::network::lan_policy::LanPolicy::from_manifest(Some(&serde_json::json!([
                "127.0.0.1:8123"
            ])));
        assert!(result.is_err(), "loopback must be rejected");
    }

    #[tokio::test]
    async fn add_link_local_is_rejected_by_validation() {
        let result =
            crate::network::lan_policy::LanPolicy::from_manifest(Some(&serde_json::json!([
                "169.254.169.254:80"
            ])));
        assert!(
            result.is_err(),
            "link-local/cloud-metadata must be rejected"
        );
    }

    #[tokio::test]
    async fn add_public_ip_is_rejected_by_validation() {
        let result =
            crate::network::lan_policy::LanPolicy::from_manifest(Some(&serde_json::json!([
                "8.8.8.8:53"
            ])));
        assert!(result.is_err(), "public IP must be rejected");
    }
}
