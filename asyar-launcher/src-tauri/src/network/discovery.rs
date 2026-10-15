use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDevice {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub protocol: String,
}

/// Scan for LAN devices via SSDP and mDNS concurrently.
/// Runs for `timeout_secs` seconds then returns deduplicated results.
/// Results whose source address fails `is_restricted_ip` are dropped.
pub async fn scan(timeout_secs: u64) -> Result<Vec<DiscoveredDevice>, AppError> {
    let timeout = Duration::from_secs(timeout_secs);
    let (tx, mut rx) = mpsc::channel::<DiscoveredDevice>(64);

    let ssdp_tx = tx.clone();
    let mdns_tx = tx.clone();
    drop(tx);

    let ssdp_handle = tokio::spawn(scan_ssdp(ssdp_tx, timeout));
    let mdns_handle = tokio::spawn(scan_mdns(mdns_tx, timeout));

    let collect_deadline = tokio::time::sleep(timeout + Duration::from_millis(200));
    tokio::pin!(collect_deadline);

    let mut devices: HashMap<(String, u16), DiscoveredDevice> = HashMap::new();

    loop {
        tokio::select! {
            Some(device) = rx.recv() => {
                devices.entry((device.host.clone(), device.port)).or_insert(device);
            }
            _ = &mut collect_deadline => break,
        }
    }

    ssdp_handle.abort();
    mdns_handle.abort();

    Ok(devices.into_values().collect())
}

async fn scan_ssdp(tx: mpsc::Sender<DiscoveredDevice>, timeout: Duration) {
    use if_addrs::get_if_addrs;
    use tokio::net::UdpSocket;

    // Bind to the first non-loopback IPv4 interface so SSDP egress takes the
    // right physical adapter on a multi-homed host. Falls back to INADDR_ANY.
    let bind_ip = get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback())
        .find_map(|i| match i.addr.ip() {
            IpAddr::V4(ip) => Some(ip),
            _ => None,
        })
        .unwrap_or(std::net::Ipv4Addr::UNSPECIFIED);

    let Ok(socket) = UdpSocket::bind(std::net::SocketAddrV4::new(bind_ip, 0)).await else {
        return;
    };
    let msearch = concat!(
        "M-SEARCH * HTTP/1.1\r\n",
        "HOST: 239.255.255.250:1900\r\n",
        "MAN: \"ssdp:discover\"\r\n",
        "MX: 3\r\n",
        "ST: ssdp:all\r\n",
        "\r\n"
    );

    if socket
        .send_to(msearch.as_bytes(), "239.255.255.250:1900")
        .await
        .is_err()
    {
        return;
    }

    let deadline = tokio::time::Instant::now() + timeout;
    let mut buf = vec![0u8; 4096];

    while let Ok(Ok((n, addr))) =
        tokio::time::timeout_at(deadline, socket.recv_from(&mut buf)).await
    {
        let text = String::from_utf8_lossy(&buf[..n]);
        if !crate::network::service::is_restricted_ip(&addr.ip()) {
            continue;
        }
        let name = extract_ssdp_header(&text, "Server")
            .or_else(|| extract_ssdp_header(&text, "USN"))
            .unwrap_or_else(|| addr.ip().to_string());
        let device = DiscoveredDevice {
            name,
            host: addr.ip().to_string(),
            port: addr.port(),
            protocol: "ssdp".to_string(),
        };
        let _ = tx.send(device).await;
    }
}

fn extract_ssdp_header(response: &str, header: &str) -> Option<String> {
    let prefix = format!("{header}:");
    response
        .lines()
        .find(|l| {
            l.to_ascii_uppercase()
                .starts_with(&prefix.to_ascii_uppercase())
        })
        .map(|l| l[prefix.len()..].trim().to_string())
        .filter(|v| !v.is_empty())
}

async fn scan_mdns(tx: mpsc::Sender<DiscoveredDevice>, timeout: Duration) {
    use mdns_sd::{ServiceDaemon, ServiceEvent};

    let Ok(mdns) = ServiceDaemon::new() else {
        return;
    };

    let service_types = [
        "_sonos._tcp.local.",
        "_hap._tcp.local.",
        "_home-assistant._tcp.local.",
        "_googlecast._tcp.local.",
        "_ipp._tcp.local.",
        "_http._tcp.local.",
    ];

    let deadline = tokio::time::Instant::now() + timeout;

    for stype in &service_types {
        let Ok(receiver) = mdns.browse(stype) else {
            continue;
        };
        let tx = tx.clone();

        tokio::spawn(async move {
            while let Ok(Ok(ServiceEvent::ServiceResolved(info))) =
                tokio::time::timeout_at(deadline, receiver.recv_async()).await
            {
                let hostname = info.get_hostname().trim_end_matches('.').to_string();
                let port = info.get_port();
                // get_addresses() returns &HashSet<IpAddr> in mdns-sd 0.11
                let addrs = info.get_addresses();
                let all_restricted = addrs.iter().all(crate::network::service::is_restricted_ip);
                if all_restricted && !addrs.is_empty() {
                    let name = info
                        .get_properties()
                        .get_property_val_str("fn")
                        .map(str::to_string)
                        .unwrap_or_else(|| hostname.clone());
                    let _ = tx
                        .send(DiscoveredDevice {
                            name,
                            host: hostname,
                            port,
                            protocol: "mdns".to_string(),
                        })
                        .await;
                }
            }
        });
    }

    tokio::time::sleep(timeout).await;
    let _ = mdns.shutdown();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_ssdp_server_header() {
        let response =
            "HTTP/1.1 200 OK\r\nSERVER: Linux/4.9 UPnP/1.1 Sonos/58.1\r\nUSN: uuid:abc\r\n\r\n";
        let server = extract_ssdp_header(response, "Server");
        assert_eq!(server.as_deref(), Some("Linux/4.9 UPnP/1.1 Sonos/58.1"));
    }

    #[test]
    fn extract_ssdp_returns_none_for_missing_header() {
        let response = "HTTP/1.1 200 OK\r\n\r\n";
        assert!(extract_ssdp_header(response, "Server").is_none());
    }

    #[test]
    fn ssdp_public_ip_fails_is_restricted_ip_guard() {
        let public: IpAddr = "8.8.8.8".parse().unwrap();
        assert!(
            !crate::network::service::is_restricted_ip(&public),
            "8.8.8.8 must fail is_restricted_ip — public IPs must be dropped from SSDP results"
        );
        let private: IpAddr = "192.168.1.1".parse().unwrap();
        assert!(
            crate::network::service::is_restricted_ip(&private),
            "192.168.1.1 must pass is_restricted_ip — private IPs should be surfaced from SSDP"
        );
    }
}
