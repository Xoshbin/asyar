use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::SocketAddr;

#[derive(Default)]
pub struct SsrfGuardResolver {
    allow_loopback: bool,
}
impl SsrfGuardResolver {
    #[cfg(test)]
    pub fn allowing_loopback_for_tests() -> Self {
        Self {
            allow_loopback: true,
        }
    }
}
fn guard_addresses(
    addresses: Vec<SocketAddr>,
    allow_loopback: bool,
) -> Result<Addrs, std::io::Error> {
    if addresses.is_empty()
        || addresses.iter().any(|a| {
            crate::network::service::is_restricted_ip(&a.ip())
                && !(allow_loopback && a.ip().is_loopback())
        })
    {
        return Err(std::io::Error::other("Secret target DNS resolution denied"));
    }
    Ok(Box::new(addresses.into_iter()))
}
impl Resolve for SsrfGuardResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let name = name.as_str().to_owned();
        let allow = self.allow_loopback;
        Box::pin(async move {
            let addresses = tokio::net::lookup_host((name.as_str(), 0))
                .await
                .map_err(|_| std::io::Error::other("Secret target DNS resolution failed"))?
                .collect();
            guard_addresses(addresses, allow).map_err(Into::into)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rejects_hostname_resolving_to_loopback() {
        use reqwest::dns::Resolve;
        assert!(SsrfGuardResolver::default()
            .resolve("localhost".parse().unwrap())
            .await
            .is_err());
    }
    #[test]
    fn rejects_when_any_resolved_addr_private() {
        assert!(guard_addresses(
            vec![
                "8.8.8.8:443".parse().unwrap(),
                "10.0.0.1:443".parse().unwrap()
            ],
            false
        )
        .is_err());
    }
    #[test]
    fn allows_public_resolution() {
        assert!(guard_addresses(vec!["8.8.8.8:443".parse().unwrap()], false).is_ok());
    }
}
