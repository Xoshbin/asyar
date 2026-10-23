use crate::error::AppError;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

const MAX_ENTRIES: usize = 64;
const MAX_ENTRIES_PER_SCOPE: usize = 16;
const ENTRY_IDLE_TTL: Duration = Duration::from_secs(120);
const SOCKET_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_IDLE_SOCKETS_PER_HOST: usize = 4;

fn normalize_addresses(addresses: &[SocketAddr]) -> Vec<SocketAddr> {
    let mut normalized = addresses.to_vec();
    normalized.sort_unstable();
    normalized.dedup();
    normalized
}

pub(crate) fn prefer_ipv4(addresses: &[SocketAddr]) -> Vec<SocketAddr> {
    let ipv4: Vec<_> = addresses
        .iter()
        .copied()
        .filter(SocketAddr::is_ipv4)
        .collect();
    if ipv4.is_empty() {
        addresses.to_vec()
    } else {
        ipv4
    }
}

/// Ownership boundary for reusable HTTP transports.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) enum ClientScope {
    Host,
    Extension(String),
}

impl ClientScope {
    pub(crate) fn from_caller(caller_extension_id: Option<&str>) -> Self {
        match caller_extension_id.filter(|id| !id.is_empty() && *id != "asyar") {
            Some(extension_id) => Self::Extension(extension_id.to_string()),
            None => Self::Host,
        }
    }
}

/// Whether the client may honor a configured proxy or must dial its pinned
/// addresses directly.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum Route {
    Pinned,
    ProxyAllowed,
}

/// The complete, freshly authorized DNS answer is part of the key. The client
/// may dial an IPv4 subset for compatibility, but any change to the full answer
/// must select a different connection pool.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ClientKey {
    scope: ClientScope,
    route: Route,
    scheme: String,
    host: String,
    port: u16,
    authorized_addresses: Vec<SocketAddr>,
}

struct ClientEntry {
    client: reqwest::Client,
    last_used: Instant,
    last_used_sequence: u64,
}

struct PoolState {
    entries: HashMap<ClientKey, ClientEntry>,
    next_sequence: u64,
}

/// Lazy, bounded reqwest clients for extension fetches.
///
/// Construction creates no HTTP client, socket, timer, or background task.
/// Callers must resolve and authorize the complete target address set before
/// acquiring a client; this pool never caches DNS answers or authorization.
pub struct ScopedHttpClientPool {
    state: Mutex<PoolState>,
    max_entries: usize,
    max_entries_per_scope: usize,
    entry_idle_ttl: Duration,
}

impl Default for ScopedHttpClientPool {
    fn default() -> Self {
        Self::new()
    }
}

impl ScopedHttpClientPool {
    pub(crate) fn new() -> Self {
        Self::with_limits(MAX_ENTRIES, MAX_ENTRIES_PER_SCOPE, ENTRY_IDLE_TTL)
    }

    fn with_limits(
        max_entries: usize,
        max_entries_per_scope: usize,
        entry_idle_ttl: Duration,
    ) -> Self {
        Self {
            state: Mutex::new(PoolState {
                entries: HashMap::new(),
                next_sequence: 0,
            }),
            max_entries: max_entries.max(1),
            max_entries_per_scope: max_entries_per_scope.max(1),
            entry_idle_ttl,
        }
    }

    pub(crate) fn acquire(
        &self,
        scope: ClientScope,
        route: Route,
        scheme: &str,
        host: &str,
        port: u16,
        authorized_addresses: &[SocketAddr],
    ) -> Result<reqwest::Client, AppError> {
        self.acquire_at(
            scope,
            route,
            scheme,
            host,
            port,
            authorized_addresses,
            Instant::now(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn acquire_at(
        &self,
        scope: ClientScope,
        route: Route,
        scheme: &str,
        host: &str,
        port: u16,
        authorized_addresses: &[SocketAddr],
        now: Instant,
    ) -> Result<reqwest::Client, AppError> {
        let normalized_addresses = normalize_addresses(authorized_addresses);
        let key = ClientKey {
            scope,
            route,
            scheme: scheme.to_string(),
            host: host.to_string(),
            port,
            authorized_addresses: normalized_addresses.clone(),
        };
        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::Other("Scoped HTTP client pool lock failed".into()))?;

        state.entries.retain(|_, entry| {
            now.saturating_duration_since(entry.last_used) <= self.entry_idle_ttl
        });
        state.next_sequence = state.next_sequence.wrapping_add(1);
        let sequence = state.next_sequence;

        if let Some(entry) = state.entries.get_mut(&key) {
            entry.last_used = now;
            entry.last_used_sequence = sequence;
            return Ok(entry.client.clone());
        }

        if state
            .entries
            .keys()
            .filter(|entry_key| entry_key.scope == key.scope)
            .count()
            >= self.max_entries_per_scope
        {
            remove_lru(&mut state, Some(&key.scope));
        }
        if state.entries.len() >= self.max_entries {
            remove_lru(&mut state, None);
        }

        let client = build_client(host, &normalized_addresses, route)?;
        state.entries.insert(
            key,
            ClientEntry {
                client: client.clone(),
                last_used: now,
                last_used_sequence: sequence,
            },
        );
        Ok(client)
    }

    /// Drop every retained client owned by an extension. Idle sockets close
    /// when their final client handle is dropped; in-flight requests may finish.
    pub(crate) fn evict_extension(&self, extension_id: &str) -> usize {
        let Ok(mut state) = self.state.lock() else {
            return 0;
        };
        let before = state.entries.len();
        state.entries.retain(
            |key, _| !matches!(&key.scope, ClientScope::Extension(id) if id == extension_id),
        );
        before - state.entries.len()
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.state
            .lock()
            .map(|state| state.entries.len())
            .unwrap_or(0)
    }

    #[cfg(test)]
    pub(crate) fn len_for_scope(&self, scope: &ClientScope) -> usize {
        self.state
            .lock()
            .map(|state| {
                state
                    .entries
                    .keys()
                    .filter(|key| &key.scope == scope)
                    .count()
            })
            .unwrap_or(0)
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    fn contains(
        &self,
        scope: &ClientScope,
        route: Route,
        scheme: &str,
        host: &str,
        port: u16,
        authorized_addresses: &[SocketAddr],
    ) -> bool {
        let key = ClientKey {
            scope: scope.clone(),
            route,
            scheme: scheme.to_string(),
            host: host.to_string(),
            port,
            authorized_addresses: normalize_addresses(authorized_addresses),
        };
        self.state
            .lock()
            .map(|state| state.entries.contains_key(&key))
            .unwrap_or(false)
    }
}

/// Evict an extension through the managed-state boundary used by permission,
/// settings, and lifecycle commands. Test harnesses that do not manage the
/// network pool remain valid and simply have nothing to evict.
pub(crate) fn evict_managed_extension<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    extension_id: &str,
) -> usize {
    app_handle
        .try_state::<ScopedHttpClientPool>()
        .map(|pool| pool.evict_extension(extension_id))
        .unwrap_or(0)
}

fn remove_lru(state: &mut PoolState, scope: Option<&ClientScope>) {
    let lru_key = state
        .entries
        .iter()
        .filter(|(key, _)| scope.is_none_or(|scope| &key.scope == scope))
        .min_by_key(|(_, entry)| entry.last_used_sequence)
        .map(|(key, _)| key.clone());
    if let Some(key) = lru_key {
        state.entries.remove(&key);
    }
}

fn build_client(
    host: &str,
    authorized_addresses: &[SocketAddr],
    route: Route,
) -> Result<reqwest::Client, AppError> {
    let mut builder = reqwest::Client::builder();
    if route == Route::Pinned {
        builder = builder.no_proxy();
    }
    Ok(builder
        .connect_timeout(Duration::from_secs(10))
        .pool_idle_timeout(SOCKET_IDLE_TIMEOUT)
        .pool_max_idle_per_host(MAX_IDLE_SOCKETS_PER_HOST)
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &prefer_ipv4(authorized_addresses))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")
        .build()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::{Duration, Instant};
    use tauri::Manager;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    fn extension(id: &str) -> ClientScope {
        ClientScope::Extension(id.to_string())
    }

    fn address(value: &str) -> SocketAddr {
        value.parse().unwrap()
    }

    #[test]
    fn new_pool_is_empty_and_allocates_clients_lazily() {
        let pool = ScopedHttpClientPool::new();

        assert_eq!(pool.len(), 0);
    }

    #[tokio::test]
    async fn reuses_one_keep_alive_connection_for_repeated_requests() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = listener.local_addr().unwrap();
        let accepted = Arc::new(AtomicUsize::new(0));
        let server_accepted = Arc::clone(&accepted);
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            server_accepted.fetch_add(1, Ordering::SeqCst);
            let (reader, mut writer) = stream.into_split();
            let mut reader = BufReader::new(reader);
            for _ in 0..3 {
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).await.unwrap();
                    if line == "\r\n" {
                        break;
                    }
                }
                writer
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok",
                    )
                    .await
                    .unwrap();
            }
        });

        let pool = ScopedHttpClientPool::new();
        let url = format!("http://speaker.local:{}/status", target.port());
        for _ in 0..3 {
            let client = pool
                .acquire(
                    extension("org.asyar.sonos"),
                    Route::Pinned,
                    "http",
                    "speaker.local",
                    target.port(),
                    &[target],
                )
                .unwrap();
            let response = tokio::time::timeout(Duration::from_secs(2), client.get(&url).send())
                .await
                .expect("request must not wait for a second connection")
                .unwrap();
            assert_eq!(response.text().await.unwrap(), "ok");
        }
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(accepted.load(Ordering::SeqCst), 1);
        assert_eq!(pool.len(), 1);
    }

    #[test]
    fn changed_full_dns_answer_creates_a_new_client_even_when_dial_set_is_unchanged() {
        let pool = ScopedHttpClientPool::new();
        let first = [address("192.168.1.20:1400")];
        let second = [address("192.168.1.20:1400"), address("[fd00::20]:1400")];

        pool.acquire(
            extension("org.asyar.sonos"),
            Route::Pinned,
            "http",
            "speaker.local",
            1400,
            &first,
        )
        .unwrap();
        pool.acquire(
            extension("org.asyar.sonos"),
            Route::Pinned,
            "http",
            "speaker.local",
            1400,
            &second,
        )
        .unwrap();

        assert_eq!(pool.len(), 2);
        assert!(pool.contains(
            &extension("org.asyar.sonos"),
            Route::Pinned,
            "http",
            "speaker.local",
            1400,
            &first,
        ));
        assert!(pool.contains(
            &extension("org.asyar.sonos"),
            Route::Pinned,
            "http",
            "speaker.local",
            1400,
            &second,
        ));
    }

    #[test]
    fn isolates_clients_between_extensions() {
        let pool = ScopedHttpClientPool::new();
        let addresses = [address("192.168.1.20:1400")];

        for scope in [extension("org.asyar.alpha"), extension("org.asyar.beta")] {
            pool.acquire(
                scope,
                Route::Pinned,
                "http",
                "speaker.local",
                1400,
                &addresses,
            )
            .unwrap();
        }

        assert_eq!(pool.len(), 2);
    }

    #[test]
    fn isolates_pinned_and_proxy_allowed_routes() {
        let pool = ScopedHttpClientPool::new();
        let addresses = [address("192.168.1.20:1400")];
        let scope = extension("org.asyar.alpha");

        for route in [Route::Pinned, Route::ProxyAllowed] {
            pool.acquire(
                scope.clone(),
                route,
                "http",
                "speaker.local",
                1400,
                &addresses,
            )
            .unwrap();
        }

        assert_eq!(pool.len(), 2);
    }

    #[test]
    fn normalizes_address_order_and_duplicates() {
        let pool = ScopedHttpClientPool::new();
        let first = [address("192.168.1.20:1400"), address("192.168.1.21:1400")];
        let reordered = [
            address("192.168.1.21:1400"),
            address("192.168.1.20:1400"),
            address("192.168.1.20:1400"),
        ];

        pool.acquire(
            extension("org.asyar.sonos"),
            Route::Pinned,
            "http",
            "speaker.local",
            1400,
            &first,
        )
        .unwrap();
        pool.acquire(
            extension("org.asyar.sonos"),
            Route::Pinned,
            "http",
            "speaker.local",
            1400,
            &reordered,
        )
        .unwrap();

        assert_eq!(pool.len(), 1);
    }

    #[test]
    fn evicts_global_least_recently_used_entry() {
        let pool = ScopedHttpClientPool::with_limits(2, 4, Duration::from_secs(60));
        let now = Instant::now();
        let first = [address("192.168.1.20:1400")];
        let second = [address("192.168.1.21:1400")];
        let third = [address("192.168.1.22:1400")];
        let scope = extension("org.asyar.alpha");

        pool.acquire_at(
            scope.clone(),
            Route::Pinned,
            "http",
            "one.local",
            1400,
            &first,
            now,
        )
        .unwrap();
        pool.acquire_at(
            scope.clone(),
            Route::Pinned,
            "http",
            "two.local",
            1400,
            &second,
            now,
        )
        .unwrap();
        pool.acquire_at(
            scope.clone(),
            Route::Pinned,
            "http",
            "one.local",
            1400,
            &first,
            now,
        )
        .unwrap();
        pool.acquire_at(
            scope.clone(),
            Route::Pinned,
            "http",
            "three.local",
            1400,
            &third,
            now,
        )
        .unwrap();

        assert!(pool.contains(&scope, Route::Pinned, "http", "one.local", 1400, &first));
        assert!(!pool.contains(&scope, Route::Pinned, "http", "two.local", 1400, &second));
        assert!(pool.contains(&scope, Route::Pinned, "http", "three.local", 1400, &third));
    }

    #[test]
    fn extension_cap_self_evicts_before_global_entries() {
        let pool = ScopedHttpClientPool::with_limits(4, 2, Duration::from_secs(60));
        let now = Instant::now();
        let alpha = extension("org.asyar.alpha");
        let beta = extension("org.asyar.beta");

        pool.acquire_at(
            beta.clone(),
            Route::Pinned,
            "http",
            "beta.local",
            1400,
            &[address("192.168.1.10:1400")],
            now,
        )
        .unwrap();
        for (host, ip) in [
            ("one.local", "192.168.1.20:1400"),
            ("two.local", "192.168.1.21:1400"),
            ("three.local", "192.168.1.22:1400"),
        ] {
            pool.acquire_at(
                alpha.clone(),
                Route::Pinned,
                "http",
                host,
                1400,
                &[address(ip)],
                now,
            )
            .unwrap();
        }

        assert_eq!(pool.len_for_scope(&alpha), 2);
        assert_eq!(pool.len_for_scope(&beta), 1);
        assert!(pool.contains(
            &beta,
            Route::Pinned,
            "http",
            "beta.local",
            1400,
            &[address("192.168.1.10:1400")],
        ));
    }

    #[test]
    fn expires_inactive_entries_without_sleeping() {
        let pool = ScopedHttpClientPool::with_limits(4, 4, Duration::from_secs(120));
        let start = Instant::now();
        let scope = extension("org.asyar.alpha");
        let first = [address("192.168.1.20:1400")];
        let second = [address("192.168.1.21:1400")];

        pool.acquire_at(
            scope.clone(),
            Route::Pinned,
            "http",
            "one.local",
            1400,
            &first,
            start,
        )
        .unwrap();
        pool.acquire_at(
            scope.clone(),
            Route::Pinned,
            "http",
            "two.local",
            1400,
            &second,
            start + Duration::from_secs(121),
        )
        .unwrap();

        assert_eq!(pool.len(), 1);
        assert!(!pool.contains(&scope, Route::Pinned, "http", "one.local", 1400, &first));
        assert!(pool.contains(&scope, Route::Pinned, "http", "two.local", 1400, &second));
    }

    #[test]
    fn evict_extension_drops_only_that_extensions_entries() {
        let pool = ScopedHttpClientPool::new();
        let addresses = [address("192.168.1.20:1400")];
        for id in ["org.asyar.alpha", "org.asyar.beta"] {
            pool.acquire(
                extension(id),
                Route::Pinned,
                "http",
                "speaker.local",
                1400,
                &addresses,
            )
            .unwrap();
        }

        assert_eq!(pool.evict_extension("org.asyar.alpha"), 1);
        assert_eq!(pool.len_for_scope(&extension("org.asyar.alpha")), 0);
        assert_eq!(pool.len_for_scope(&extension("org.asyar.beta")), 1);
    }

    #[test]
    fn managed_eviction_drops_the_extensions_idle_clients() {
        let app = tauri::test::mock_app();
        let pool = ScopedHttpClientPool::new();
        pool.acquire(
            extension("org.asyar.alpha"),
            Route::Pinned,
            "http",
            "speaker.local",
            1400,
            &[address("192.168.1.20:1400")],
        )
        .unwrap();
        app.manage(pool);

        assert_eq!(evict_managed_extension(app.handle(), "org.asyar.alpha"), 1);
        let pool: tauri::State<'_, ScopedHttpClientPool> = app.state();
        assert_eq!(pool.len_for_scope(&extension("org.asyar.alpha")), 0);
    }
}
