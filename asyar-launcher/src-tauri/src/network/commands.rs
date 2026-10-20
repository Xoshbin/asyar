use crate::error::AppError;
use crate::network::discovery::DiscoveredDevice;
use crate::permissions::ExtensionPermissionRegistry;
use crate::storage::lan_allowed_hosts::{self, LanAllowedHost};
use crate::storage::DataStore;
use tauri::{Emitter, State};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanDeviceRef {
    pub host: String,
    pub port: u16,
    pub label: String,
}

fn project_lan_devices(rows: &[LanAllowedHost]) -> Vec<LanDeviceRef> {
    rows.iter()
        .map(|row| LanDeviceRef {
            host: row.host.clone(),
            port: row.port,
            label: row.label.clone(),
        })
        .collect()
}

#[tauri::command]
pub async fn lan_devices_for_caller(
    caller_extension_id: Option<String>,
    registry: State<'_, ExtensionPermissionRegistry>,
    store: State<'_, DataStore>,
) -> Result<Vec<LanDeviceRef>, AppError> {
    registry.check(&caller_extension_id, "network:lan")?;
    let Some(extension_id) = caller_extension_id else {
        return Ok(Vec::new());
    };
    let conn = store.conn()?;
    let rows = lan_allowed_hosts::list(&conn, &extension_id)?;
    Ok(project_lan_devices(&rows))
}

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
    // Store the canonical form the policy matches against, so `HA.local` and
    // `ha.local.` can't become two separate approvals of the same device.
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
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

/// Scan for LAN devices via SSDP and mDNS, streaming accepted rows to the caller.
/// Settings-window only — must NOT be reachable by extensions.
#[tauri::command]
pub async fn scan_lan_devices(
    app: tauri::AppHandle,
    scan_id: String,
    custom_services: Option<Vec<String>>,
) -> Result<Vec<DiscoveredDevice>, AppError> {
    crate::network::discovery::scan_streaming(
        crate::network::discovery::DEFAULT_SCAN_SECS,
        &custom_services.unwrap_or_default(),
        move |device| {
            let _ = app.emit(
                "asyar:lan-device-discovered",
                serde_json::json!({ "scanId": scan_id, "device": device }),
            );
        },
    )
    .await
}

#[tauri::command]
pub async fn lan_host_validate(host: String, port: u16) -> Result<(), AppError> {
    crate::network::lan_policy::LanPolicy::from_manifest(Some(&serde_json::json!([format!(
        "{host}:{port}"
    )])))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_device_ref_serialises_only_host_port_label() {
        let json = serde_json::to_value(LanDeviceRef {
            host: "192.168.1.50".into(),
            port: 1400,
            label: "Living Room".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "host": "192.168.1.50", "port": 1400, "label": "Living Room" })
        );
    }

    #[test]
    fn lan_device_refs_are_projected_from_storage_rows() {
        let rows = vec![LanAllowedHost {
            id: "row-1".into(),
            extension_id: "org.test".into(),
            host: "192.168.1.50".into(),
            port: 1400,
            label: "Living Room".into(),
            created_at: 1_700_000_000,
        }];
        let refs = project_lan_devices(&rows);
        assert_eq!(refs.len(), 1);
        assert_eq!(
            (refs[0].host.as_str(), refs[0].port),
            ("192.168.1.50", 1400)
        );
    }

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

    #[tokio::test]
    async fn lan_host_validate_enforces_policy() {
        assert!(lan_host_validate("192.168.1.50".into(), 8080).await.is_ok());
        assert!(lan_host_validate("ha.local".into(), 8123).await.is_ok());
        assert!(lan_host_validate("127.0.0.1".into(), 80).await.is_err());
        assert!(lan_host_validate("169.254.169.254".into(), 80)
            .await
            .is_err());
        assert!(lan_host_validate("8.8.8.8".into(), 53).await.is_err());
    }
}
