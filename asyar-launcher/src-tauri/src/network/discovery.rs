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
    pub service_type: String,
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
        if let Some(device) = ssdp_device_from_response(&text, addr.ip()) {
            let _ = tx.send(device).await;
        }
    }
}

fn parse_location_url(location: &str) -> Option<(IpAddr, u16)> {
    let url = url::Url::parse(location).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let ip = url.host_str()?.parse::<IpAddr>().ok()?;
    let port = url.port_or_known_default()?;
    (crate::network::service::is_restricted_ip(&ip)
        && !crate::network::lan_policy::is_never_allowed(&ip))
    .then_some((ip, port))
}

fn ssdp_device_from_response(text: &str, source: IpAddr) -> Option<DiscoveredDevice> {
    let (host, port) = parse_location_url(&extract_ssdp_header(text, "Location")?)?;
    if host != source {
        return None;
    }
    Some(DiscoveredDevice {
        name: extract_ssdp_header(text, "Server")
            .or_else(|| extract_ssdp_header(text, "USN"))
            .unwrap_or_else(|| host.to_string()),
        host: host.to_string(),
        port,
        protocol: "ssdp".to_string(),
        service_type: extract_ssdp_header(text, "ST")
            .or_else(|| extract_ssdp_header(text, "NT"))
            .unwrap_or_default(),
    })
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

fn resolve_mdns_port(info: &mdns_sd::ServiceInfo) -> (u16, Option<String>) {
    let service_type = (!info.get_type().is_empty()).then(|| info.get_type().to_string());
    let port = if info.get_type().eq_ignore_ascii_case("_sonos._tcp.local.") {
        info.get_properties()
            .get_property_val_str("location")
            .and_then(parse_location_url)
            .map(|(_, port)| port)
            .unwrap_or_else(|| info.get_port())
    } else {
        info.get_port()
    };
    (port, service_type)
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
        let stype = stype.to_string();

        tokio::spawn(async move {
            while let Ok(Ok(ServiceEvent::ServiceResolved(info))) =
                tokio::time::timeout_at(deadline, receiver.recv_async()).await
            {
                let hostname = info.get_hostname().trim_end_matches('.').to_string();
                let (port, service_type) = resolve_mdns_port(&info);
                // get_addresses() returns &HashSet<IpAddr> in mdns-sd 0.11
                let addrs = info.get_addresses();
                let all_restricted = addrs.iter().all(|ip| {
                    crate::network::service::is_restricted_ip(ip)
                        && !crate::network::lan_policy::is_never_allowed(ip)
                });
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
                            service_type: service_type.unwrap_or_else(|| stype.clone()),
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
    fn location_url_yields_host_and_explicit_port() {
        assert_eq!(
            parse_location_url("http://192.168.1.50:1400/xml/device_description.xml"),
            Some(("192.168.1.50".parse().unwrap(), 1400))
        );
    }

    #[test]
    fn location_url_without_port_defaults_to_scheme_port() {
        assert_eq!(
            parse_location_url("http://192.168.1.50/desc.xml"),
            Some(("192.168.1.50".parse().unwrap(), 80))
        );
        assert_eq!(
            parse_location_url("https://192.168.1.50/desc.xml"),
            Some(("192.168.1.50".parse().unwrap(), 443))
        );
    }

    #[test]
    fn location_url_rejects_non_http_unparseable_and_unsafe_hosts() {
        for location in [
            "rtsp://192.168.1.50:554/stream",
            "uuid:abc-def",
            "",
            "http://127.0.0.1:1400/desc.xml",
            "http://169.254.169.254/latest/meta",
            "http://8.8.8.8:80/desc.xml",
            "http://speaker.local:1400/desc.xml",
        ] {
            assert!(parse_location_url(location).is_none(), "{location}");
        }
    }

    #[test]
    fn ssdp_response_reports_the_location_port_not_the_source_port() {
        let text = "HTTP/1.1 200 OK\r\n\
                    LOCATION: http://192.168.1.50:1400/xml/device_description.xml\r\n\
                    SERVER: Linux UPnP/1.0 Sonos/84.1\r\n\
                    ST: urn:schemas-upnp-org:device:ZonePlayer:1\r\n\
                    USN: uuid:RINCON_ABC::urn:schemas-upnp-org:device:ZonePlayer:1\r\n\r\n";
        let device = ssdp_device_from_response(text, "192.168.1.50".parse().unwrap())
            .expect("a well-formed Sonos reply must be surfaced");
        assert_eq!(device.host, "192.168.1.50");
        assert_eq!(device.port, 1400);
        assert_eq!(device.protocol, "ssdp");
        assert_eq!(
            device.service_type,
            "urn:schemas-upnp-org:device:ZonePlayer:1"
        );
        assert_eq!(device.name, "Linux UPnP/1.0 Sonos/84.1");
    }

    #[test]
    fn ssdp_response_without_location_is_dropped() {
        let text = "HTTP/1.1 200 OK\r\nSERVER: Linux UPnP/1.0\r\nST: upnp:rootdevice\r\n\r\n";
        assert!(ssdp_device_from_response(text, "192.168.1.50".parse().unwrap()).is_none());
    }

    #[test]
    fn ssdp_response_advertising_a_foreign_host_is_dropped() {
        let text = "HTTP/1.1 200 OK\r\n\
                    LOCATION: http://192.168.1.1:80/desc.xml\r\n\
                    ST: upnp:rootdevice\r\n\r\n";
        assert!(ssdp_device_from_response(text, "192.168.1.50".parse().unwrap()).is_none());
    }

    fn mdns_info(service_type: &str, port: u16, location: Option<&str>) -> mdns_sd::ServiceInfo {
        let properties = location.map(|value| {
            std::collections::HashMap::from([("location".to_string(), value.to_string())])
        });
        mdns_sd::ServiceInfo::new(
            service_type,
            "Living Room",
            "sonos.local.",
            "192.168.1.50",
            port,
            properties,
        )
        .unwrap()
    }

    #[test]
    fn mdns_sonos_location_resolves_http_port_and_service_type() {
        let info = mdns_info(
            "_sonos._tcp.local.",
            1443,
            Some("http://192.168.1.50:1400/xml/device_description.xml"),
        );
        assert_eq!(
            resolve_mdns_port(&info),
            (1400, Some("_sonos._tcp.local.".to_string()))
        );
    }

    #[test]
    fn mdns_missing_or_malformed_location_falls_back_to_srv_port() {
        for location in [
            None,
            Some(""),
            Some("not-a-url"),
            Some("rtsp://192.168.1.50:554/s"),
        ] {
            let info = mdns_info("_sonos._tcp.local.", 1443, location);
            assert_eq!(
                resolve_mdns_port(&info),
                (1443, Some("_sonos._tcp.local.".to_string()))
            );
        }
    }

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
