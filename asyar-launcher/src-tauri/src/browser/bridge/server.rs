use crate::browser::bridge::BridgeState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

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
        other => return Err((StatusCode::BAD_REQUEST, format!("unknown family: {}", other))),
    };
    let key = crate::browser::types::BrowserKey {
        family,
        variant: body.variant.clone(),
    };
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

pub async fn start_server<R: tauri::Runtime>(
    state: BridgeState<R>,
) -> Result<ServerHandle, String> {
    let app = Router::new()
        .route("/discover", get(discover_handler))
        .route("/pair-request", post(pair_request_handler::<R>))
        .route("/pair-status/:pairing_id", get(pair_status_handler::<R>))
        .with_state(state);

    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .map_err(|e| e.to_string())?;
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
        token_store::InMemoryTokenStore,
    };
    use std::sync::Arc;

    fn build_test_state() -> BridgeState<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        BridgeState {
            tokens: Arc::new(InMemoryTokenStore::new()),
            pairing: Arc::new(PairingRegistry::new()),
            connections: Arc::new(CompanionRegistry::new()),
            cache: Arc::new(TabSnapshotCache::new()),
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
            .post(format!(
                "http://127.0.0.1:{}/pair-request",
                handle.port()
            ))
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
    async fn pair_status_returns_approved_with_token_after_resolve() {
        use crate::browser::types::{BrowserFamily, BrowserKey, PairDecision};
        let state = build_test_state();
        let handle = start_server(state.clone()).await.unwrap();
        let client = reqwest::Client::new();

        let req: serde_json::Value = client
            .post(format!(
                "http://127.0.0.1:{}/pair-request",
                handle.port()
            ))
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

    #[tokio::test]
    async fn pair_status_returns_denied_after_resolve() {
        use crate::browser::types::PairDecision;
        let state = build_test_state();
        let handle = start_server(state.clone()).await.unwrap();
        let client = reqwest::Client::new();
        let req: serde_json::Value = client
            .post(format!(
                "http://127.0.0.1:{}/pair-request",
                handle.port()
            ))
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
