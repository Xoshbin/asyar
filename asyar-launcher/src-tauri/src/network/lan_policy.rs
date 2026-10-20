use crate::error::AppError;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Debug, Clone)]
pub struct LanPolicy {
    endpoints: Vec<LanEndpoint>,
}

#[derive(Debug, Clone)]
struct LanEndpoint {
    target: Target,
    port: u16,
}

#[derive(Debug, Clone)]
enum Target {
    Host(String),
    Cidr { network: IpAddr, prefix: u8 },
}

impl LanPolicy {
    /// Parses `permissionArgs["network:lan"]`. Tolerates `None` (bare
    /// `network:lan`, user-managed hosts only) and empty arrays.
    pub fn from_manifest(value: Option<&serde_json::Value>) -> Result<Self, AppError> {
        let Some(value) = value else {
            return Ok(Self { endpoints: vec![] });
        };
        let entries = value
            .as_array()
            .ok_or_else(|| invalid("must be an array"))?;
        if entries.is_empty() {
            return Ok(Self { endpoints: vec![] });
        }
        let endpoints = entries
            .iter()
            .map(|entry| {
                let entry = entry
                    .as_str()
                    .ok_or_else(|| invalid("entries must be strings"))?;
                parse_endpoint(entry)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self { endpoints })
    }

    /// Merge user-managed hosts into this policy. Each `LanAllowedHost` was
    /// already validated at insert time, so malformed rows are silently skipped.
    pub fn merge_user_hosts(
        &mut self,
        hosts: &[crate::storage::lan_allowed_hosts::LanAllowedHost],
    ) {
        for h in hosts {
            if let Ok(ep) = parse_endpoint(&format!("{}:{}", h.host, h.port)) {
                self.endpoints.push(ep);
            }
        }
    }

    pub fn authorize(&self, host: &str, port: u16, addresses: &[IpAddr]) -> Result<(), AppError> {
        if addresses.is_empty() || addresses.iter().any(is_never_allowed) {
            return Err(denied(host, port));
        }
        let normalized_host = host.trim_end_matches('.').to_ascii_lowercase();
        let allowed = self.endpoints.iter().any(|endpoint| {
            endpoint.port == port
                && match &endpoint.target {
                    Target::Host(declared) => {
                        declared == &normalized_host
                            && addresses.iter().all(|ip| {
                                crate::network::service::is_restricted_ip(ip)
                                    && !is_never_allowed(ip)
                            })
                    }
                    Target::Cidr { network, prefix } => addresses
                        .iter()
                        .all(|ip| ip_in_cidr(ip, network, *prefix) && !is_never_allowed(ip)),
                }
        });
        if allowed {
            Ok(())
        } else {
            Err(denied(host, port))
        }
    }
}

fn parse_endpoint(entry: &str) -> Result<LanEndpoint, AppError> {
    let (target, port) = if let Some(rest) = entry.strip_prefix('[') {
        let (target, suffix) = rest
            .split_once(']')
            .ok_or_else(|| invalid("IPv6 endpoints must use [address/prefix]:port"))?;
        (
            target,
            suffix
                .strip_prefix(':')
                .ok_or_else(|| invalid("missing port"))?,
        )
    } else {
        entry
            .rsplit_once(':')
            .ok_or_else(|| invalid("missing port"))?
    };
    let port = port
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
        .ok_or_else(|| invalid("port must be between 1 and 65535"))?;

    let target = if let Some((network, prefix)) = target.split_once('/') {
        let network = network
            .parse::<IpAddr>()
            .map_err(|_| invalid("CIDR address is invalid"))?;
        let prefix = prefix
            .parse::<u8>()
            .map_err(|_| invalid("CIDR prefix is invalid"))?;
        let max = if network.is_ipv4() { 32 } else { 128 };
        if prefix > max
            || !is_network_address(&network, prefix)
            || !crate::network::service::is_restricted_ip(&network)
            || is_never_allowed(&network)
            || cidr_contains_unsafe(&network, prefix)
        {
            return Err(invalid(
                "CIDR must be canonical and must not include loopback or link-local addresses",
            ));
        }
        Target::Cidr { network, prefix }
    } else {
        let host = target.trim_end_matches('.').to_ascii_lowercase();
        if host.is_empty() || host == "localhost" || host.contains('/') {
            return Err(invalid("host is invalid"));
        }
        if let Ok(ip) = host.parse::<IpAddr>() {
            if is_never_allowed(&ip) || !crate::network::service::is_restricted_ip(&ip) {
                return Err(invalid(
                    "literal endpoints must be private LAN addresses and cannot be loopback, link-local, multicast, or cloud metadata",
                ));
            }
        } else if host.contains(':') {
            return Err(invalid("host is invalid"));
        } else {
            match url::Host::parse(&host).map_err(|_| invalid("host is invalid"))? {
                url::Host::Domain(domain) => {
                    return Ok(LanEndpoint {
                        target: Target::Host(domain.to_ascii_lowercase()),
                        port,
                    })
                }
                url::Host::Ipv4(_) | url::Host::Ipv6(_) => {
                    return Err(invalid("host is invalid"));
                }
            }
        }
        Target::Host(host)
    };
    Ok(LanEndpoint { target, port })
}

fn invalid(reason: &str) -> AppError {
    AppError::Validation(format!("permissionArgs.network:lan {reason}"))
}

fn denied(host: &str, port: u16) -> AppError {
    AppError::Permission(format!(
        "LAN endpoint '{host}:{port}' is not declared in permissionArgs.network:lan"
    ))
}

pub fn is_never_allowed(ip: &IpAddr) -> bool {
    if is_cloud_metadata(ip) {
        return true;
    }
    match ip {
        IpAddr::V4(ip) => {
            ip.is_loopback()
                || ip.is_link_local()
                || ip.is_multicast()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_documentation()
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || (ip.segments()[0] & 0xffc0) == 0xfe80
                || (ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8)
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|ip| is_never_allowed(&IpAddr::V4(ip)))
        }
    }
}

fn is_cloud_metadata(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            *ip == Ipv4Addr::new(169, 254, 169, 254) || *ip == Ipv4Addr::new(100, 100, 100, 200)
        }
        IpAddr::V6(ip) => *ip == "fd00:ec2::254".parse::<Ipv6Addr>().expect("constant IPv6"),
    }
}

fn ip_in_cidr(ip: &IpAddr, network: &IpAddr, prefix: u8) -> bool {
    match (ip, network) {
        (IpAddr::V4(ip), IpAddr::V4(network)) => {
            let mask = if prefix == 0 {
                0
            } else {
                u32::MAX << (32 - prefix)
            };
            u32::from(*ip) & mask == u32::from(*network) & mask
        }
        (IpAddr::V6(ip), IpAddr::V6(network)) => {
            let mask = if prefix == 0 {
                0
            } else {
                u128::MAX << (128 - prefix)
            };
            u128::from(*ip) & mask == u128::from(*network) & mask
        }
        _ => false,
    }
}

fn is_network_address(network: &IpAddr, prefix: u8) -> bool {
    ip_in_cidr(network, network, prefix)
        && match network {
            IpAddr::V4(ip) => {
                let mask = if prefix == 0 {
                    0
                } else {
                    u32::MAX << (32 - prefix)
                };
                u32::from(*ip) & !mask == 0
            }
            IpAddr::V6(ip) => {
                let mask = if prefix == 0 {
                    0
                } else {
                    u128::MAX << (128 - prefix)
                };
                u128::from(*ip) & !mask == 0
            }
        }
}

fn cidr_contains_unsafe(network: &IpAddr, prefix: u8) -> bool {
    let unsafe_addresses = [
        IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254)),
        IpAddr::V4(Ipv4Addr::new(169, 254, 0, 1)),
        IpAddr::V4(Ipv4Addr::new(100, 100, 100, 200)),
        IpAddr::V6(Ipv6Addr::LOCALHOST),
        IpAddr::V6("fe80::1".parse().expect("constant IPv6 address")),
        IpAddr::V6("fd00:ec2::254".parse().expect("constant IPv6 address")),
    ];
    unsafe_addresses
        .iter()
        .any(|ip| ip_in_cidr(ip, network, prefix))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn declared_host_and_port_authorize_only_that_endpoint() {
        let policy = LanPolicy::from_manifest(Some(&serde_json::json!(["speaker.local:1400"])))
            .expect("valid LAN policy");

        assert!(policy
            .authorize(
                "speaker.local",
                1400,
                &[IpAddr::V4(Ipv4Addr::new(192, 168, 1, 9))]
            )
            .is_ok());
        assert!(policy
            .authorize(
                "speaker.local",
                80,
                &[IpAddr::V4(Ipv4Addr::new(192, 168, 1, 9))]
            )
            .is_err());
        assert!(policy
            .authorize(
                "other.local",
                1400,
                &[IpAddr::V4(Ipv4Addr::new(192, 168, 1, 9))]
            )
            .is_err());
    }

    #[test]
    fn declared_cidr_and_port_authorize_only_addresses_inside_the_range() {
        let policy = LanPolicy::from_manifest(Some(&serde_json::json!(["192.168.0.0/16:1400"])))
            .expect("valid LAN policy");

        assert!(policy
            .authorize(
                "192.168.1.25",
                1400,
                &[IpAddr::V4(Ipv4Addr::new(192, 168, 1, 25))]
            )
            .is_ok());
        assert!(policy
            .authorize("10.0.0.2", 1400, &[IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2))])
            .is_err());
    }

    #[test]
    fn safety_critical_ranges_stay_blocked_even_when_declared() {
        for target in [
            "127.0.0.1:1400",
            "169.254.169.254:80",
            "169.254.1.2:1400",
            "100.100.100.200:80",
            "[fd00:ec2::254]:80",
            "239.255.255.250:1900",
        ] {
            assert!(
                LanPolicy::from_manifest(Some(&serde_json::json!([target]))).is_err(),
                "{target}"
            );
        }
    }

    #[test]
    fn from_manifest_with_none_returns_empty_policy() {
        let policy = LanPolicy::from_manifest(None).expect("bare network:lan must succeed");
        let err = policy.authorize(
            "192.168.1.50",
            1400,
            &[std::net::IpAddr::V4(std::net::Ipv4Addr::new(
                192, 168, 1, 50,
            ))],
        );
        assert!(err.is_err(), "empty policy must deny private IPs");
    }

    #[test]
    fn from_manifest_with_empty_array_returns_empty_policy() {
        let policy = LanPolicy::from_manifest(Some(&serde_json::json!([])))
            .expect("empty array must succeed");
        let err = policy.authorize(
            "192.168.1.50",
            1400,
            &[std::net::IpAddr::V4(std::net::Ipv4Addr::new(
                192, 168, 1, 50,
            ))],
        );
        assert!(err.is_err());
    }

    #[test]
    fn merge_user_hosts_adds_endpoint_to_empty_policy() {
        let mut policy = LanPolicy::from_manifest(None).unwrap();
        let host = crate::storage::lan_allowed_hosts::LanAllowedHost {
            id: "x".into(),
            extension_id: "org.test".into(),
            host: "ha.local".into(),
            port: 8123,
            label: "".into(),
            created_at: 0,
        };
        policy.merge_user_hosts(&[host]);
        assert!(policy
            .authorize(
                "ha.local",
                8123,
                &[std::net::IpAddr::V4(std::net::Ipv4Addr::new(
                    192, 168, 1, 50
                ))]
            )
            .is_ok());
    }

    #[test]
    fn merge_user_hosts_manifest_cidr_and_user_host_both_authorize() {
        let mut policy =
            LanPolicy::from_manifest(Some(&serde_json::json!(["192.168.0.0/16:1400"]))).unwrap();
        let host = crate::storage::lan_allowed_hosts::LanAllowedHost {
            id: "x".into(),
            extension_id: "org.test".into(),
            host: "ha.local".into(),
            port: 8123,
            label: "".into(),
            created_at: 0,
        };
        policy.merge_user_hosts(&[host]);
        assert!(policy
            .authorize(
                "192.168.1.25",
                1400,
                &[std::net::IpAddr::V4(std::net::Ipv4Addr::new(
                    192, 168, 1, 25
                ))]
            )
            .is_ok());
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
                "other.local",
                9000,
                &[std::net::IpAddr::V4(std::net::Ipv4Addr::new(
                    192, 168, 1, 99
                ))]
            )
            .is_err());
    }

    #[test]
    fn every_dns_answer_must_be_authorized_to_prevent_rebinding() {
        let policy = LanPolicy::from_manifest(Some(&serde_json::json!(["speaker.local:1400"])))
            .expect("valid LAN policy");
        let mixed = [
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 9)),
            IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
        ];

        assert!(policy.authorize("speaker.local", 1400, &mixed).is_err());
    }
}
