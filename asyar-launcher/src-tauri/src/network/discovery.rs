use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::{hash_map::Entry, HashMap, HashSet};
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
pub const DEFAULT_SCAN_SECS: u64 = 8;
const MAX_CUSTOM_SERVICES: usize = 8;
const MAX_DISCOVERED_TYPES: usize = 64;
const META_QUERY: &str = "_services._dns-sd._udp.local.";

pub async fn scan(timeout_secs: u64) -> Result<Vec<DiscoveredDevice>, AppError> {
    scan_streaming(timeout_secs, &[], |_| {}).await
}

pub async fn scan_streaming(
    timeout_secs: u64,
    custom_services: &[String],
    on_accept: impl Fn(&DiscoveredDevice) + Send + Sync + 'static,
) -> Result<Vec<DiscoveredDevice>, AppError> {
    let custom_services = normalize_custom_services(custom_services)?;
    let timeout = Duration::from_secs(timeout_secs);
    let (tx, mut rx) = mpsc::channel::<DiscoveredDevice>(64);

    let ssdp_tx = tx.clone();
    let mdns_tx = tx.clone();
    drop(tx);

    let ssdp_handle = tokio::spawn(scan_ssdp(ssdp_tx, timeout));
    let mdns_handle = tokio::spawn(scan_mdns(mdns_tx, timeout, custom_services));

    let collect_deadline = tokio::time::sleep(timeout + Duration::from_millis(200));
    tokio::pin!(collect_deadline);

    let mut devices: HashMap<(String, u16), DiscoveredDevice> = HashMap::new();

    loop {
        tokio::select! {
            Some(device) = rx.recv() => if insert_device(&mut devices, device.clone()) { on_accept(&device) },
            _ = &mut collect_deadline => break,
        }
    }

    ssdp_handle.abort();
    mdns_handle.abort();

    Ok(devices.into_values().collect())
}

/// Rank a record when both protocols report the same `(host, port)`, so the
/// surviving row does not depend on which answer arrives first. mDNS carries
/// the user-set device name in its `fn` TXT record ("Family Room TV"); SSDP
/// only has a generic `Server` header while mDNS can carry a friendly name.
/// and falls back to the bare IP when even that is missing.
fn name_rank(device: &DiscoveredDevice) -> u8 {
    if device.name == device.host {
        0
    } else if device.protocol == "mdns" {
        2
    } else {
        1
    }
}

/// Insert `device`, keeping the better-named record when a `(host, port)` is
/// already present. Ties keep the incumbent.
fn insert_device(
    devices: &mut HashMap<(String, u16), DiscoveredDevice>,
    device: DiscoveredDevice,
) -> bool {
    match devices.entry((device.host.clone(), device.port)) {
        Entry::Occupied(mut slot) => {
            if name_rank(&device) > name_rank(slot.get()) {
                slot.insert(device);
                true
            } else {
                false
            }
        }
        Entry::Vacant(slot) => {
            slot.insert(device);
            true
        }
    }
}

fn normalize_service_type(raw: &str) -> Option<String> {
    let value = format!("{}.", raw.trim().trim_end_matches('.').to_ascii_lowercase());
    if value == META_QUERY {
        return None;
    }
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 4
        || parts[2] != "local"
        || !parts[3].is_empty()
        || !matches!(parts[1], "_tcp" | "_udp")
    {
        return None;
    }
    let label = parts[0];
    if !label.starts_with('_') || !(2..=16).contains(&label.len()) {
        return None;
    }
    label[1..]
        .bytes()
        .enumerate()
        .all(|(i, b)| b.is_ascii_lowercase() || b.is_ascii_digit() || (b == b'-' && i > 0))
        .then_some(value)
}

fn normalize_custom_services(custom_services: &[String]) -> Result<Vec<String>, AppError> {
    if custom_services.is_empty() {
        return Ok(vec![]);
    }
    let services = custom_services
        .iter()
        .filter_map(|s| normalize_service_type(s))
        .collect::<HashSet<_>>()
        .into_iter()
        .take(MAX_CUSTOM_SERVICES)
        .collect::<Vec<_>>();
    if services.is_empty() {
        return Err(AppError::Validation(
            "No valid DNS-SD service types supplied".into(),
        ));
    }
    Ok(services)
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

    // SSDP runs over lossy multicast UDP; the UPnP spec recommends sending the
    // search more than once so a single dropped datagram doesn't hide devices.
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        if socket
            .send_to(msearch.as_bytes(), "239.255.255.250:1900")
            .await
            .is_err()
        {
            return;
        }
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

/// Prefer an explicit HTTP(S) endpoint advertised by DNS-SD TXT metadata.
///
/// The platform makes no assumptions about service vendors or protocols: a
/// companion endpoint is used only when the device itself advertises it.
fn resolve_mdns_port(info: &mdns_sd::ServiceInfo) -> (u16, Option<String>) {
    let service_type = (!info.get_type().is_empty()).then(|| info.get_type().to_string());
    let port = ["location", "url"]
        .into_iter()
        .filter_map(|key| info.get_properties().get_property_val_str(key))
        .filter_map(parse_location_url)
        .find(|(ip, _)| info.get_addresses().contains(ip))
        .map(|(_, port)| port)
        .unwrap_or_else(|| info.get_port());
    (port, service_type)
}

async fn scan_mdns(
    tx: mpsc::Sender<DiscoveredDevice>,
    timeout: Duration,
    custom_services: Vec<String>,
) {
    use mdns_sd::{ServiceDaemon, ServiceEvent};

    let Ok(mdns) = ServiceDaemon::new() else {
        return;
    };

    let deadline = tokio::time::Instant::now() + timeout;
    let mut browsed_types: HashSet<String> = HashSet::new();

    let spawn_browse = |stype: String,
                        daemon: &ServiceDaemon,
                        sender: mpsc::Sender<DiscoveredDevice>| {
        let Ok(receiver) = daemon.browse(&stype) else {
            return;
        };
        let stype_name = stype.clone();
        tokio::spawn(async move {
            while let Ok(Ok(event)) = tokio::time::timeout_at(deadline, receiver.recv_async()).await
            {
                let ServiceEvent::ServiceResolved(info) = event else {
                    continue;
                };
                if let Some(device) = mdns_device_from_info(&info, &stype_name) {
                    let _ = sender.send(device).await;
                }
            }
        });
    };

    // Phase A: extension-declared types start immediately. The host otherwise
    // remains vendor-neutral and discovers all available types through DNS-SD.
    for custom in custom_services {
        if browsed_types.insert(custom.clone()) {
            spawn_browse(custom, &mdns, tx.clone());
        }
    }

    // Phase B: browse META_QUERY on parent task
    if let Ok(meta_receiver) = mdns.browse(META_QUERY) {
        while let Ok(Ok(event)) =
            tokio::time::timeout_at(deadline, meta_receiver.recv_async()).await
        {
            if let ServiceEvent::ServiceFound(_service_name, alias) = event {
                // Phase C: for each newly-seen type (re-validated, capped at MAX_DISCOVERED_TYPES)
                if let Some(normalized) = normalize_service_type(&alias) {
                    if browsed_types.len() < MAX_DISCOVERED_TYPES
                        && browsed_types.insert(normalized.clone())
                    {
                        spawn_browse(normalized, &mdns, tx.clone());
                    }
                }
            }
        }
    }

    let now = tokio::time::Instant::now();
    if now < deadline {
        tokio::time::sleep(deadline - now).await;
    }
    let _ = mdns.shutdown();
}

fn mdns_device_from_info(
    info: &mdns_sd::ServiceInfo,
    default_service_type: &str,
) -> Option<DiscoveredDevice> {
    let hostname = info.get_hostname().trim_end_matches('.').to_string();
    let (port, service_type) = resolve_mdns_port(info);
    let addrs = info.get_addresses();

    let valid_ip = addrs
        .iter()
        .filter(|ip| {
            crate::network::service::is_restricted_ip(ip)
                && !crate::network::lan_policy::is_never_allowed(ip)
        })
        .max_by_key(|ip| match ip {
            IpAddr::V4(_) => 2,
            IpAddr::V6(_) => 1,
        })?;

    let name = info
        .get_properties()
        .get_property_val_str("fn")
        .map(str::to_string)
        .unwrap_or_else(|| hostname.clone());

    Some(DiscoveredDevice {
        name,
        host: valid_ip.to_string(),
        port,
        protocol: "mdns".to_string(),
        service_type: service_type.unwrap_or_else(|| default_service_type.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_rejects_untrusted_service_types() {
        assert_eq!(
            normalize_service_type("_MQTT._TCP.local"),
            Some("_mqtt._tcp.local.".to_string())
        );
        assert_eq!(
            normalize_service_type("_mqtt._tcp.local."),
            Some("_mqtt._tcp.local.".to_string())
        );
        assert_eq!(
            normalize_service_type("_airplay._tcp.local"),
            Some("_airplay._tcp.local.".to_string())
        );
        for invalid in [
            "",
            "http",
            "..",
            "../x",
            "_x._sctp.local.",
            "_services._dns-sd._udp.local.",
            "_a-very-long-label-exceeding-fifteen-chars._tcp.local.",
            "_-invalidstart._tcp.local.",
        ] {
            assert_eq!(normalize_service_type(invalid), None, "{invalid}");
        }
    }

    #[test]
    fn normalize_custom_services_dedupes_caps_and_validates() {
        assert_eq!(
            normalize_custom_services(&[]).unwrap(),
            Vec::<String>::new()
        );

        let input = vec![
            "_mqtt._tcp.local".to_string(),
            "_MQTT._tcp.local.".to_string(),
            "_airplay._tcp.local".to_string(),
        ];
        let normalized = normalize_custom_services(&input).unwrap();
        assert_eq!(normalized.len(), 2);
        assert!(normalized.contains(&"_mqtt._tcp.local.".to_string()));
        assert!(normalized.contains(&"_airplay._tcp.local.".to_string()));

        let invalid = vec!["invalid".to_string(), "".to_string()];
        assert!(normalize_custom_services(&invalid).is_err());
    }

    #[test]
    fn insert_device_returns_true_only_on_insert_or_upgrade() {
        let mut devices = HashMap::new();
        let dev1 = device("ssdp", "192.168.1.50", 80);
        assert!(insert_device(&mut devices, dev1));

        // Same device, no rank change -> false
        let dev1_dup = device("ssdp", "192.168.1.50", 80);
        assert!(!insert_device(&mut devices, dev1_dup));

        // Upgraded name rank (mdns friendly name) -> true
        let dev1_upgrade = DiscoveredDevice {
            name: "Smart Bulb".to_string(),
            host: "192.168.1.50".to_string(),
            port: 80,
            protocol: "mdns".to_string(),
            service_type: "_http._tcp.local.".to_string(),
        };
        assert!(insert_device(&mut devices, dev1_upgrade));

        // Lower or equal rank -> false
        let dev1_lower = device("ssdp", "Linux UPnP", 80);
        assert!(!insert_device(&mut devices, dev1_lower));
    }

    #[test]
    fn mdns_device_from_info_surfaces_private_ipv4_and_friendly_name() {
        let info = mdns_sd::ServiceInfo::new(
            "_example-device._tcp.local.",
            "Example-ABC",
            "cast.local.",
            "192.168.1.172",
            8009,
            HashMap::from([("fn".to_string(), "Family Room TV".to_string())]),
        )
        .unwrap();
        let device = mdns_device_from_info(&info, "_example-device._tcp.local.")
            .expect("should surface valid device");
        assert_eq!(device.name, "Family Room TV");
        assert_eq!(device.host, "192.168.1.172");
        assert_eq!(device.port, 8009);
        assert_eq!(device.protocol, "mdns");
        assert_eq!(device.service_type, "_example-device._tcp.local.");
    }

    #[test]
    fn mdns_device_from_info_prefers_private_ipv4_over_link_local_ipv6() {
        let info = mdns_sd::ServiceInfo::new(
            "_example-device._tcp.local.",
            "Example-ABC",
            "cast.local.",
            &["192.168.1.172", "fe80::de0f:abda:8b5f:81db"][..],
            8009,
            HashMap::from([("fn".to_string(), "Family Room TV".to_string())]),
        )
        .unwrap();
        let device = mdns_device_from_info(&info, "_example-device._tcp.local.")
            .expect("should surface device even if link-local IPv6 is present");
        assert_eq!(device.host, "192.168.1.172");
    }

    #[test]
    fn mdns_device_from_info_drops_device_with_only_unsafe_addresses() {
        for unsafe_ip in ["127.0.0.1", "169.254.1.1", "8.8.8.8", "fe80::1"] {
            let info = mdns_sd::ServiceInfo::new(
                "_example-device._tcp.local.",
                "Example-ABC",
                "cast.local.",
                unsafe_ip,
                8009,
                HashMap::<String, String>::new(),
            )
            .unwrap();
            assert!(
                mdns_device_from_info(&info, "_example-device._tcp.local.").is_none(),
                "unsafe ip {unsafe_ip} must not be surfaced"
            );
        }
    }

    #[test]
    fn mdns_device_from_info_falls_back_to_hostname_when_fn_txt_missing() {
        let info = mdns_sd::ServiceInfo::new(
            "_example-device._tcp.local.",
            "Example-ABC",
            "cast.local.",
            "192.168.1.172",
            8009,
            HashMap::<String, String>::new(),
        )
        .unwrap();
        let device = mdns_device_from_info(&info, "_example-device._tcp.local.")
            .expect("should surface valid device");
        assert_eq!(device.name, "cast.local");
    }

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
                    SERVER: Linux UPnP/1.0 Example/84.1\r\n\
                    ST: urn:schemas-upnp-org:device:ZonePlayer:1\r\n\
                    USN: uuid:RINCON_ABC::urn:schemas-upnp-org:device:ZonePlayer:1\r\n\r\n";
        let device = ssdp_device_from_response(text, "192.168.1.50".parse().unwrap())
            .expect("a well-formed SSDP reply must be surfaced");
        assert_eq!(device.host, "192.168.1.50");
        assert_eq!(device.port, 1400);
        assert_eq!(device.protocol, "ssdp");
        assert_eq!(
            device.service_type,
            "urn:schemas-upnp-org:device:ZonePlayer:1"
        );
        assert_eq!(device.name, "Linux UPnP/1.0 Example/84.1");
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
            "example.local.",
            "192.168.1.50",
            port,
            properties,
        )
        .unwrap()
    }

    #[test]
    fn mdns_location_txt_resolves_http_port_for_any_service_type() {
        let info = mdns_info(
            "_vendor-device._tcp.local.",
            1443,
            Some("http://192.168.1.50:1400/xml/device_description.xml"),
        );
        assert_eq!(
            resolve_mdns_port(&info),
            (1400, Some("_vendor-device._tcp.local.".to_string()))
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
            let info = mdns_info("_vendor-device._tcp.local.", 1443, location);
            assert_eq!(
                resolve_mdns_port(&info),
                (1443, Some("_vendor-device._tcp.local.".to_string()))
            );
        }
    }

    #[test]
    fn mdns_without_generic_endpoint_metadata_keeps_srv_port() {
        let info = mdns_info("_vendor-device._tcp.local.", 8009, None);
        assert_eq!(resolve_mdns_port(&info).0, 8009);
    }

    fn device(protocol: &str, name: &str, port: u16) -> DiscoveredDevice {
        DiscoveredDevice {
            name: name.to_string(),
            host: "192.168.1.172".to_string(),
            port,
            protocol: protocol.to_string(),
            service_type: String::new(),
        }
    }

    fn collect(records: Vec<DiscoveredDevice>) -> HashMap<(String, u16), DiscoveredDevice> {
        let mut devices = HashMap::new();
        for record in records {
            insert_device(&mut devices, record);
        }
        devices
    }

    #[test]
    fn dedup_prefers_the_mdns_friendly_name_regardless_of_arrival_order() {
        let ssdp = device("ssdp", "Linux/5.4.284+, UPnP/1.0, Example/1.6.18", 8008);
        let mdns = device("mdns", "Family Room TV", 8008);
        for order in [
            vec![ssdp.clone(), mdns.clone()],
            vec![mdns.clone(), ssdp.clone()],
        ] {
            let devices = collect(order);
            assert_eq!(devices.len(), 1);
            assert_eq!(
                devices[&("192.168.1.172".to_string(), 8008)].name,
                "Family Room TV"
            );
        }
    }

    #[test]
    fn dedup_prefers_a_named_record_over_the_bare_ip_fallback() {
        let devices = collect(vec![
            device("ssdp", "192.168.1.172", 8008),
            device("ssdp", "Linux UPnP/1.0 Example/84.1", 8008),
        ]);
        assert_eq!(
            devices[&("192.168.1.172".to_string(), 8008)].name,
            "Linux UPnP/1.0 Example/84.1"
        );
    }

    #[test]
    fn dedup_keeps_ssdp_only_devices_and_distinct_ports_as_separate_rows() {
        let devices = collect(vec![
            device("ssdp", "Linux UPnP/1.0 Example/84.1", 1400),
            device("mdns", "Family Room TV", 8008),
        ]);
        assert_eq!(devices.len(), 2);
        assert_eq!(
            devices[&("192.168.1.172".to_string(), 1400)].name,
            "Linux UPnP/1.0 Example/84.1"
        );
    }

    #[test]
    fn extract_ssdp_server_header() {
        let response =
            "HTTP/1.1 200 OK\r\nSERVER: Linux/4.9 UPnP/1.1 Example/58.1\r\nUSN: uuid:abc\r\n\r\n";
        let server = extract_ssdp_header(response, "Server");
        assert_eq!(server.as_deref(), Some("Linux/4.9 UPnP/1.1 Example/58.1"));
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
