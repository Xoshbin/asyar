use crate::browser::bridge::BridgeState;
use axum::{
    extract::{ws::WebSocketUpgrade, Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

/// Browser companions discover the launcher by probing this fixed port range,
/// so the bridge MUST bind within it (not an OS-assigned random port).
const BRIDGE_PORT_RANGE: std::ops::RangeInclusive<u16> = 54300..=54320;

/// Binds the first free port from `ports` on 127.0.0.1. Returns an error if none
/// are available — we deliberately do NOT fall back to a random port, because a
/// port outside the discovery range is unreachable by browser companions.
async fn bind_in_range(ports: impl IntoIterator<Item = u16>) -> Result<TcpListener, String> {
    for port in ports {
        if let Ok(listener) = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await {
            return Ok(listener);
        }
    }
    Err("no free port available in the browser bridge range (54300-54320)".to_string())
}

pub struct ServerHandle {
    port: u16,
    shutdown_tx: tokio::sync::oneshot::Sender<()>,
    join: JoinHandle<()>,
}

impl ServerHandle {
    pub fn port(&self) -> u16 {
        self.port
    }

    pub async fn shutdown(self) {
        let _ = self.shutdown_tx.send(());
        let _ = self.join.await;
    }
}

/// Per-peer connection throttle shared by the `/pair-request` and `/bridge`
/// routes. Returns a `429 Too Many Requests` error (with a `Retry-After` hint in
/// the body) when the browser key has exceeded its rate budget, or `None` when
/// the request may proceed.
fn throttle<R: tauri::Runtime>(
    state: &BridgeState<R>,
    key: &crate::browser::types::BrowserKey,
) -> Option<(StatusCode, String)> {
    use crate::browser::bridge::rate_limit::RateDecision;
    match state.rate_limiter.check(key) {
        RateDecision::Allow => None,
        RateDecision::Deny { retry_after_secs } => Some((
            StatusCode::TOO_MANY_REQUESTS,
            format!("rate limited; retry after {retry_after_secs}s"),
        )),
    }
}

async fn discover_handler() -> Json<serde_json::Value> {
    Json(json!({
        "name": "asyar",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

#[derive(serde::Deserialize)]
struct PairRequestBody {
    family: String,
    variant: String,
}

async fn pair_request_handler<R: tauri::Runtime>(
    State(state): State<BridgeState<R>>,
    Json(body): Json<PairRequestBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let family = match body.family.as_str() {
        "chromium" => crate::browser::types::BrowserFamily::Chromium,
        "firefox" => crate::browser::types::BrowserFamily::Firefox,
        "safari" => crate::browser::types::BrowserFamily::Safari,
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("unknown family: {}", other),
            ))
        }
    };
    let key = crate::browser::types::BrowserKey {
        family,
        variant: body.variant.clone(),
    };
    if let Some(err) = throttle(&state, &key) {
        return Err(err);
    }
    let pairing_id = state.pairing.request(key).await;

    use tauri::Emitter;
    let _ = state.app_handle.emit(
        "browser:pair-request",
        serde_json::json!({
            "pairing_id": pairing_id,
            "family": body.family,
            "variant": body.variant,
        }),
    );

    Ok(Json(serde_json::json!({ "pairing_id": pairing_id })))
}

async fn pair_status_handler<R: tauri::Runtime>(
    State(state): State<BridgeState<R>>,
    Path(pairing_id): Path<String>,
) -> Json<serde_json::Value> {
    use crate::browser::bridge::pairing::PairingOutcome;
    let outcome = state
        .pairing
        .wait(&pairing_id, std::time::Duration::from_secs(60))
        .await;
    Json(match outcome {
        PairingOutcome::Approved { token } => {
            serde_json::json!({ "status": "approved", "token": token })
        }
        PairingOutcome::Denied => serde_json::json!({ "status": "denied" }),
        PairingOutcome::TimedOut => serde_json::json!({ "status": "timed_out" }),
        PairingOutcome::Unknown => serde_json::json!({ "status": "unknown" }),
    })
}

#[derive(serde::Deserialize)]
struct BridgeQuery {
    family: String,
    variant: String,
}

/// Browsers can't set the Authorization header on a WebSocket, so the companion
/// smuggles the token through `Sec-WebSocket-Protocol` as a `bearer.<token>`
/// entry alongside the protocol marker `asyar.v1`. Returns the token if present.
pub fn token_from_subprotocols(header_value: &str) -> Option<String> {
    header_value
        .split(',')
        .map(|s| s.trim())
        .find_map(|entry| entry.strip_prefix("bearer.").map(|t| t.to_string()))
}

/// WebSocket close codes that tell a browser companion WHY its `/bridge`
/// connection was rejected. A browser's `WebSocket` API cannot read the HTTP
/// status of a *failed* upgrade, so instead of rejecting with `401`/`429` (which
/// the companion only ever sees as an opaque `1006`), we accept the upgrade and
/// immediately close with one of these. That lets the companion react correctly:
/// clear a stale token and re-pair, or back off without discarding a valid one.
pub const WS_CLOSE_AUTH: u16 = 1008; // Policy Violation: bad/missing token or no pairing.
pub const WS_CLOSE_THROTTLED: u16 = 1013; // Try Again Later: rate limited.

/// Sends a single Close frame and drops the socket. Used for the rejection paths
/// above — no connection is registered and no data is exchanged.
async fn close_with<S>(mut socket: S, code: u16, reason: &'static str)
where
    S: futures_util::Sink<axum::extract::ws::Message> + Unpin,
{
    use axum::extract::ws::{CloseFrame, Message};
    use futures_util::SinkExt;
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await;
}

async fn bridge_ws_handler<R: tauri::Runtime>(
    ws: WebSocketUpgrade,
    State(state): State<BridgeState<R>>,
    axum::extract::Query(q): axum::extract::Query<BridgeQuery>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, String)> {
    use crate::browser::bridge::rate_limit::RateDecision;

    let family = match q.family.as_str() {
        "chromium" => crate::browser::types::BrowserFamily::Chromium,
        "firefox" => crate::browser::types::BrowserFamily::Firefox,
        "safari" => crate::browser::types::BrowserFamily::Safari,
        other => return Err((StatusCode::BAD_REQUEST, format!("bad family: {}", other))),
    };
    let key = crate::browser::types::BrowserKey {
        family,
        variant: q.variant.clone(),
    };

    // 1. Authorization: Bearer <token>  (non-browser clients, tests)
    let header_token = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string());
    // 2. Sec-WebSocket-Protocol: asyar.v1, bearer.<token>  (browsers)
    let subproto_token = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .and_then(token_from_subprotocols);
    let used_subprotocol = subproto_token.is_some();

    // Browsers close the socket if the server does not echo one of the offered
    // subprotocols — including on the rejection paths below, otherwise our close
    // frame (and its reason code) would never reach the companion.
    let ws = if used_subprotocol {
        ws.protocols(["asyar.v1"])
    } else {
        ws
    };

    // Throttle BEFORE any auth work so a reconnect storm can't hammer the token
    // store (and, through it, the OS keychain). Tell the companion to back off
    // via a 1013 close rather than an HTTP 429 it cannot read.
    if matches!(state.rate_limiter.check(&key), RateDecision::Deny { .. }) {
        return Ok(ws.on_upgrade(|socket| close_with(socket, WS_CLOSE_THROTTLED, "rate limited")));
    }

    // Authenticate. ANY failure (missing token, no pairing, mismatch) closes with
    // 1008 so the companion clears its stale token and re-pairs — instead of
    // looping forever against an invisible 401.
    let Some(token) = header_token.or(subproto_token) else {
        return Ok(ws.on_upgrade(|socket| close_with(socket, WS_CLOSE_AUTH, "missing token")));
    };
    let stored = state
        .tokens
        .get(&key)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    if stored.as_deref() != Some(token.as_str()) {
        return Ok(ws.on_upgrade(|socket| close_with(socket, WS_CLOSE_AUTH, "unauthorized")));
    }

    let state_for_socket = state.clone();
    Ok(ws.on_upgrade(move |socket| {
        crate::browser::bridge::ws_handler::handle_socket(socket, state_for_socket, key)
    }))
}

pub async fn start_server<R: tauri::Runtime>(
    state: BridgeState<R>,
) -> Result<ServerHandle, String> {
    let app = Router::new()
        .route("/discover", get(discover_handler))
        .route("/pair-request", post(pair_request_handler::<R>))
        .route("/pair-status/:pairing_id", get(pair_status_handler::<R>))
        .route("/bridge", get(bridge_ws_handler::<R>))
        .with_state(state);

    let listener = bind_in_range(BRIDGE_PORT_RANGE).await?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let join = tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    Ok(ServerHandle {
        port,
        shutdown_tx,
        join,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::bridge::{
        cache::TabSnapshotCache, connections::CompanionRegistry, pairing::PairingRegistry,
        rate_limit::ConnectionRateLimiter, token_store::InMemoryTokenStore,
    };
    use std::sync::Arc;

    fn build_test_state() -> BridgeState<tauri::test::MockRuntime> {
        build_test_state_with_limiter(ConnectionRateLimiter::default())
    }

    fn build_test_state_with_limiter(
        limiter: ConnectionRateLimiter,
    ) -> BridgeState<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        BridgeState {
            tokens: Arc::new(InMemoryTokenStore::new()),
            pairing: Arc::new(PairingRegistry::new()),
            connections: Arc::new(CompanionRegistry::new()),
            cache: Arc::new(TabSnapshotCache::new()),
            events: Arc::new(crate::browser::events::BrowserEventsHub::new()),
            last_active: Arc::new(std::sync::RwLock::new(None)),
            rate_limiter: Arc::new(limiter),
            app_handle: app.handle().clone(),
        }
    }

    #[tokio::test]
    async fn start_server_returns_nonzero_port() {
        let state = build_test_state();
        let handle = start_server(state).await.unwrap();
        assert!(handle.port() > 0, "expected nonzero OS-assigned port");
        handle.shutdown().await;
    }

    #[tokio::test]
    async fn start_server_binds_within_discovery_range() {
        let state = build_test_state();
        let handle = start_server(state).await.unwrap();
        let port = handle.port();
        assert!(
            (54300..=54320).contains(&port),
            "bridge must bind within the discovery range, got {port}"
        );
        handle.shutdown().await;
    }

    #[tokio::test]
    async fn bind_in_range_errors_when_no_ports_given() {
        let result = bind_in_range(std::iter::empty::<u16>()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn bind_in_range_skips_an_occupied_port() {
        // Occupy a port, and find a separate known-free port.
        let occupied = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .unwrap();
        let occupied_port = occupied.local_addr().unwrap().port();
        let probe = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .unwrap();
        let free_port = probe.local_addr().unwrap().port();
        drop(probe); // release it so bind_in_range can take it

        // Range = [occupied, free]; helper must skip the occupied one and bind free.
        let listener = bind_in_range([occupied_port, free_port]).await.unwrap();
        assert_eq!(listener.local_addr().unwrap().port(), free_port);
    }

    #[tokio::test]
    async fn server_responds_to_discover() {
        let state = build_test_state();
        let handle = start_server(state).await.unwrap();
        let url = format!("http://127.0.0.1:{}/discover", handle.port());
        let resp: serde_json::Value = reqwest::get(&url).await.unwrap().json().await.unwrap();
        assert_eq!(resp["name"], "asyar");
        handle.shutdown().await;
    }

    #[tokio::test]
    async fn pair_request_returns_pairing_id_and_emits_event() {
        let state = build_test_state();
        let handle = start_server(state.clone()).await.unwrap();
        let client = reqwest::Client::new();
        let resp: serde_json::Value = client
            .post(format!("http://127.0.0.1:{}/pair-request", handle.port()))
            .json(&serde_json::json!({ "family": "chromium", "variant": "chrome" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(resp["pairing_id"].is_string());
        let pending = state.pairing.pending_requests().await;
        assert_eq!(pending.len(), 1);
        handle.shutdown().await;
    }

    #[tokio::test]
    async fn pair_request_is_throttled_after_capacity() {
        let state = build_test_state_with_limiter(ConnectionRateLimiter::new(3.0, 1.0));
        let handle = start_server(state.clone()).await.unwrap();
        let client = reqwest::Client::new();
        let url = format!("http://127.0.0.1:{}/pair-request", handle.port());
        let body = serde_json::json!({ "family": "chromium", "variant": "chrome" });
        // First `capacity` rapid requests are accepted.
        for i in 0..3 {
            let resp = client.post(&url).json(&body).send().await.unwrap();
            assert_eq!(resp.status(), reqwest::StatusCode::OK, "request {i}");
        }
        // The next one in the same window is throttled.
        let resp = client.post(&url).json(&body).send().await.unwrap();
        assert_eq!(resp.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);
        handle.shutdown().await;
    }

    #[tokio::test]
    async fn bridge_ws_throttle_closes_with_1013() {
        use crate::browser::types::{BrowserFamily, BrowserKey};
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        use tokio_tungstenite::tungstenite::http::HeaderValue;

        let state = build_test_state_with_limiter(ConnectionRateLimiter::new(1.0, 1.0));
        state
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                "secret-token",
            )
            .unwrap();
        let handle = start_server(state.clone()).await.unwrap();
        let url = format!(
            "ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome",
            handle.port()
        );
        let make_req = || {
            let mut req = url.clone().into_client_request().unwrap();
            req.headers_mut().insert(
                "authorization",
                HeaderValue::from_static("Bearer secret-token"),
            );
            req
        };
        // First connection (within the burst) upgrades successfully.
        let (_socket, _resp) = tokio_tungstenite::connect_async(make_req()).await.unwrap();
        // The second within the same window is throttled — delivered as a 1013
        // "Try Again Later" close so the companion backs off WITHOUT discarding
        // its (valid) token.
        let (socket, _resp) = tokio_tungstenite::connect_async(make_req()).await.unwrap();
        assert_eq!(first_close_code(socket).await, Some(WS_CLOSE_THROTTLED));
        handle.shutdown().await;
    }

    #[tokio::test]
    async fn pair_status_returns_approved_with_token_after_resolve() {
        use crate::browser::types::{BrowserFamily, BrowserKey, PairDecision};
        let state = build_test_state();
        let handle = start_server(state.clone()).await.unwrap();
        let client = reqwest::Client::new();

        let req: serde_json::Value = client
            .post(format!("http://127.0.0.1:{}/pair-request", handle.port()))
            .json(&serde_json::json!({ "family": "chromium", "variant": "chrome" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let pairing_id = req["pairing_id"].as_str().unwrap().to_string();

        let state2 = state.clone();
        let pairing_id_clone = pairing_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let token = "test-token-xyz".to_string();
            state2
                .tokens
                .set(
                    &BrowserKey {
                        family: BrowserFamily::Chromium,
                        variant: "chrome".to_string(),
                    },
                    &token,
                )
                .unwrap();
            state2
                .pairing
                .resolve(&pairing_id_clone, PairDecision::Allow, Some(token))
                .await
                .unwrap();
        });

        let resp: serde_json::Value = client
            .get(format!(
                "http://127.0.0.1:{}/pair-status/{}",
                handle.port(),
                pairing_id
            ))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(resp["status"], "approved");
        assert_eq!(resp["token"], "test-token-xyz");
        handle.shutdown().await;
    }

    /// Reads frames until the server's Close frame arrives, returning its code.
    async fn first_close_code(
        mut socket: tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    ) -> Option<u16> {
        use futures_util::StreamExt;
        use tokio_tungstenite::tungstenite::Message;
        while let Some(msg) = socket.next().await {
            match msg {
                Ok(Message::Close(Some(frame))) => return Some(frame.code.into()),
                Ok(_) => continue,
                Err(_) => return None,
            }
        }
        None
    }

    #[tokio::test]
    async fn ws_closes_with_1008_when_token_missing() {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let state = build_test_state();
        let handle = start_server(state.clone()).await.unwrap();
        let url = format!(
            "ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome",
            handle.port()
        );
        let req = url.into_client_request().unwrap();
        // The upgrade now succeeds; the rejection reason is delivered as a WS
        // close code (a browser cannot read an HTTP 401 on a failed upgrade).
        let (socket, _resp) = tokio_tungstenite::connect_async(req).await.unwrap();
        assert_eq!(first_close_code(socket).await, Some(WS_CLOSE_AUTH));
        handle.shutdown().await;
    }

    #[tokio::test]
    async fn ws_closes_with_1008_on_token_mismatch() {
        use crate::browser::types::{BrowserFamily, BrowserKey};
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        use tokio_tungstenite::tungstenite::http::HeaderValue;
        let state = build_test_state();
        // A pairing EXISTS, but the companion presents a stale/wrong token —
        // exactly the drift that caused the infinite reconnect loop.
        state
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                "the-real-token",
            )
            .unwrap();
        let handle = start_server(state.clone()).await.unwrap();
        let url = format!(
            "ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome",
            handle.port()
        );
        let mut req = url.into_client_request().unwrap();
        req.headers_mut().insert(
            "authorization",
            HeaderValue::from_static("Bearer a-stale-token"),
        );
        let (socket, _resp) = tokio_tungstenite::connect_async(req).await.unwrap();
        assert_eq!(
            first_close_code(socket).await,
            Some(WS_CLOSE_AUTH),
            "a mismatched token must yield a 1008 so the client clears it and re-pairs"
        );
        handle.shutdown().await;
    }

    #[tokio::test]
    async fn ws_accepts_with_valid_token() {
        use crate::browser::types::{BrowserFamily, BrowserKey};
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        use tokio_tungstenite::tungstenite::http::HeaderValue;
        let state = build_test_state();
        state
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                "secret-token",
            )
            .unwrap();
        let handle = start_server(state.clone()).await.unwrap();
        let url = format!(
            "ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome",
            handle.port()
        );
        let mut req = url.into_client_request().unwrap();
        req.headers_mut().insert(
            "authorization",
            HeaderValue::from_static("Bearer secret-token"),
        );
        let (mut socket, _resp) = tokio_tungstenite::connect_async(req).await.unwrap();
        use futures_util::SinkExt;
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                r#"{"type":"hello","version":1,"browser":{"family":"chromium","variant":"chrome","profiles":["Default"]}}"#.to_string(),
            ))
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert!(
            state
                .connections
                .is_connected(&BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string()
                })
                .await
        );
        handle.shutdown().await;
    }

    #[tokio::test]
    async fn ws_accepts_with_subprotocol_token() {
        use crate::browser::types::{BrowserFamily, BrowserKey};
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        use tokio_tungstenite::tungstenite::http::HeaderValue;
        let state = build_test_state();
        state
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                "secret-token",
            )
            .unwrap();
        let handle = start_server(state.clone()).await.unwrap();
        let url = format!(
            "ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome",
            handle.port()
        );
        let mut req = url.into_client_request().unwrap();
        // No Authorization header: token arrives only via the subprotocol channel,
        // exactly as a browser `new WebSocket(url, ['asyar.v1', 'bearer.<token>'])`.
        req.headers_mut().insert(
            "sec-websocket-protocol",
            HeaderValue::from_static("asyar.v1, bearer.secret-token"),
        );
        let (mut socket, resp) = tokio_tungstenite::connect_async(req).await.unwrap();
        // Server must echo back the selected subprotocol or browsers close the socket.
        assert_eq!(
            resp.headers()
                .get("sec-websocket-protocol")
                .and_then(|v| v.to_str().ok()),
            Some("asyar.v1")
        );
        use futures_util::SinkExt;
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                r#"{"type":"hello","version":1,"browser":{"family":"chromium","variant":"chrome","profiles":["Default"]}}"#.to_string(),
            ))
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert!(
            state
                .connections
                .is_connected(&BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string()
                })
                .await
        );
        handle.shutdown().await;
    }

    #[test]
    fn extracts_bearer_token_from_subprotocol_header() {
        assert_eq!(
            token_from_subprotocols("asyar.v1, bearer.TOKEN123"),
            Some("TOKEN123".to_string())
        );
    }

    #[test]
    fn subprotocol_token_tolerates_no_spaces() {
        assert_eq!(
            token_from_subprotocols("asyar.v1,bearer.abc"),
            Some("abc".to_string())
        );
    }

    #[test]
    fn subprotocol_without_bearer_entry_returns_none() {
        assert_eq!(token_from_subprotocols("asyar.v1"), None);
    }

    #[test]
    fn subprotocol_empty_returns_none() {
        assert_eq!(token_from_subprotocols(""), None);
    }

    #[tokio::test]
    async fn pair_status_returns_denied_after_resolve() {
        use crate::browser::types::PairDecision;
        let state = build_test_state();
        let handle = start_server(state.clone()).await.unwrap();
        let client = reqwest::Client::new();
        let req: serde_json::Value = client
            .post(format!("http://127.0.0.1:{}/pair-request", handle.port()))
            .json(&serde_json::json!({ "family": "firefox", "variant": "firefox" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let pairing_id = req["pairing_id"].as_str().unwrap().to_string();

        let state2 = state.clone();
        let id = pairing_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            state2
                .pairing
                .resolve(&id, PairDecision::Deny, None)
                .await
                .unwrap();
        });

        let resp: serde_json::Value = client
            .get(format!(
                "http://127.0.0.1:{}/pair-status/{}",
                handle.port(),
                pairing_id
            ))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(resp["status"], "denied");
        handle.shutdown().await;
    }
}
