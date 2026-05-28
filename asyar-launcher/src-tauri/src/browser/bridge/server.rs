use crate::browser::bridge::BridgeState;
use axum::{routing::get, Json, Router};
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

pub async fn start_server<R: tauri::Runtime>(
    state: BridgeState<R>,
) -> Result<ServerHandle, String> {
    let app = Router::new()
        .route("/discover", get(discover_handler))
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
}
