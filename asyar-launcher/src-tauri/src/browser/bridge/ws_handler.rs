use crate::browser::bridge::protocol::{CompanionMessage, ServerMessage};
use crate::browser::bridge::BridgeState;
use crate::browser::types::{BrowserKey, Tab};
use axum::extract::ws::{Message, WebSocket};
use tokio::sync::mpsc;

pub async fn handle_socket<R: tauri::Runtime>(
    socket: WebSocket,
    state: BridgeState<R>,
    key: BrowserKey,
) {
    let (tx, mut rx) = mpsc::channel::<ServerMessage>(32);
    state.connections.register(key.clone(), tx).await;

    use futures_util::{SinkExt, StreamExt};
    let (mut sender, mut receiver) = socket.split();

    let outbound = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let raw = match serde_json::to_string(&msg) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if sender.send(Message::Text(raw)).await.is_err() {
                break;
            }
        }
    });

    let state_inner = state.clone();
    let key_inner = key.clone();
    let inbound = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            let text = match msg {
                Message::Text(t) => t,
                Message::Close(_) => break,
                _ => continue,
            };
            let parsed: CompanionMessage = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };
            dispatch_message(&state_inner, &key_inner, parsed).await;
        }
    });

    let _ = tokio::join!(outbound, inbound);
    state.connections.unregister(&key).await;

    use tauri::Emitter;
    let _ = state.app_handle.emit(
        "browser:companion-disconnected",
        serde_json::json!({
            "family": format!("{:?}", key.family).to_lowercase(),
            "variant": key.variant,
        }),
    );
}

async fn dispatch_message<R: tauri::Runtime>(
    state: &BridgeState<R>,
    key: &BrowserKey,
    msg: CompanionMessage,
) {
    use tauri::Emitter;
    match msg {
        CompanionMessage::Hello { .. } => {
            let _ = state.app_handle.emit(
                "browser:companion-connected",
                serde_json::json!({
                    "family": format!("{:?}", key.family).to_lowercase(),
                    "variant": key.variant,
                }),
            );
        }
        CompanionMessage::Event { name, payload } => match name.as_str() {
            "tabs.snapshot" | "tabs.changed" => {
                if let Ok(snapshot) = serde_json::from_value::<Vec<Tab>>(payload) {
                    state.cache.set(key, snapshot.clone());
                    let _ = state.app_handle.emit(
                        "browser:tabs-changed",
                        serde_json::json!({
                            "family": format!("{:?}", key.family).to_lowercase(),
                            "variant": key.variant,
                            "tabs": snapshot,
                        }),
                    );
                }
            }
            _ => {}
        },
        CompanionMessage::Res {
            id,
            ok,
            result,
            error,
        } => {
            let outcome = if ok {
                Ok(result.unwrap_or(serde_json::Value::Null))
            } else {
                Err(error.unwrap_or_else(|| "unknown error".to_string()))
            };
            let _ = state.connections.deliver_response(&id, outcome).await;
        }
    }
}
