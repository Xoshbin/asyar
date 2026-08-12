//! Rust-managed WebSocket client manager.
//! Handles persistent connections, incoming event loops, and frame dispatch via Tauri events.

use crate::error::AppError;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        handshake::client::generate_key,
        http::Request,
        protocol::{frame::coding::CloseCode, CloseFrame},
        Message,
    },
};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsMessagePayload {
    pub socket_id: String,
    pub extension_id: String,
    pub event_type: String, // "open" | "message" | "error" | "close"
    pub data: Option<String>,
    pub code: Option<u16>,
}

struct SocketHandle {
    sender: mpsc::UnboundedSender<Message>,
    task: tokio::task::JoinHandle<()>,
    /// The extension that opened this socket — used to prevent cross-extension access.
    owner_extension_id: String,
}

#[derive(Default)]
pub struct WebSocketManager {
    sockets: Arc<Mutex<HashMap<String, SocketHandle>>>,
}

impl WebSocketManager {
    pub fn new() -> Self {
        Self {
            sockets: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn connect(
        &self,
        socket_id: String,
        url_str: String,
        headers: Option<HashMap<String, String>>,
        caller_extension_id: String,
        app: AppHandle,
    ) -> Result<(), AppError> {
        let url = Url::parse(&url_str)
            .map_err(|e| AppError::Other(format!("Invalid WebSocket URL '{}': {}", url_str, e)))?;

        let host = url
            .host_str()
            .ok_or_else(|| AppError::Other("URL missing host".to_string()))?;

        let mut req_builder = Request::builder().uri(url_str.as_str());

        // Add standard Sec-WebSocket headers
        req_builder = req_builder
            .header("Host", host)
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header("Sec-WebSocket-Key", generate_key());

        if let Some(hdrs) = headers {
            for (k, v) in hdrs {
                req_builder = req_builder.header(k, v);
            }
        }

        let request = req_builder
            .body(())
            .map_err(|e| AppError::Other(format!("Failed to build WebSocket request: {}", e)))?;

        let (ws_stream, _response) = connect_async(request)
            .await
            .map_err(|e| AppError::Other(format!("WebSocket connection failed: {}", e)))?;

        let (mut write, mut read) = ws_stream.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

        let app_clone = app.clone();

        // Spawn write loop
        let write_task = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if write.send(msg).await.is_err() {
                    break;
                }
            }
        });

        // Spawn read loop
        let sockets_ref = Arc::clone(&self.sockets);
        let socket_id_read = socket_id.clone();
        let ext_id_read = caller_extension_id.clone();

        let read_task = tokio::spawn(async move {
            // Emit "open" event
            let _ = app_clone.emit(
                "asyar:event:network:wsMessage",
                WsMessagePayload {
                    socket_id: socket_id_read.clone(),
                    extension_id: ext_id_read.clone(),
                    event_type: "open".to_string(),
                    data: None,
                    code: None,
                },
            );

            while let Some(msg_res) = read.next().await {
                match msg_res {
                    Ok(Message::Text(text)) => {
                        let _ = app_clone.emit(
                            "asyar:event:network:wsMessage",
                            WsMessagePayload {
                                socket_id: socket_id_read.clone(),
                                extension_id: ext_id_read.clone(),
                                event_type: "message".to_string(),
                                data: Some(text.to_string()),
                                code: None,
                            },
                        );
                    }
                    Ok(Message::Binary(bin)) => {
                        let base64_str = base64::Engine::encode(
                            &base64::engine::general_purpose::STANDARD,
                            &bin,
                        );
                        let _ = app_clone.emit(
                            "asyar:event:network:wsMessage",
                            WsMessagePayload {
                                socket_id: socket_id_read.clone(),
                                extension_id: ext_id_read.clone(),
                                event_type: "message".to_string(),
                                data: Some(base64_str),
                                code: None,
                            },
                        );
                    }
                    Ok(Message::Close(frame)) => {
                        let code = frame.as_ref().map(|f| u16::from(f.code));
                        let reason = frame.as_ref().map(|f| f.reason.to_string());
                        let _ = app_clone.emit(
                            "asyar:event:network:wsMessage",
                            WsMessagePayload {
                                socket_id: socket_id_read.clone(),
                                extension_id: ext_id_read.clone(),
                                event_type: "close".to_string(),
                                data: reason,
                                code,
                            },
                        );
                        break;
                    }
                    Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {
                        // Ping/Pong handled automatically by tungstenite
                    }
                    Ok(_) => {}
                    Err(e) => {
                        let _ = app_clone.emit(
                            "asyar:event:network:wsMessage",
                            WsMessagePayload {
                                socket_id: socket_id_read.clone(),
                                extension_id: ext_id_read.clone(),
                                event_type: "error".to_string(),
                                data: Some(e.to_string()),
                                code: None,
                            },
                        );
                        break;
                    }
                }
            }

            // Cleanup socket from registry
            if let Ok(mut guard) = sockets_ref.lock() {
                guard.remove(&socket_id_read);
            }
            write_task.abort();
        });

        let handle = SocketHandle {
            sender: tx,
            task: read_task,
            owner_extension_id: caller_extension_id,
        };

        if let Ok(mut guard) = self.sockets.lock() {
            guard.insert(socket_id, handle);
        }

        Ok(())
    }

    /// Sends a text message on the socket. Verifies the caller owns the socket.
    pub fn send(
        &self,
        socket_id: &str,
        data: String,
        caller_extension_id: &str,
    ) -> Result<(), AppError> {
        let guard = self
            .sockets
            .lock()
            .map_err(|_| AppError::Other("Lock failed".to_string()))?;
        if let Some(handle) = guard.get(socket_id) {
            if handle.owner_extension_id != caller_extension_id {
                return Err(AppError::Other(format!(
                    "Extension '{}' is not the owner of socket '{}'",
                    caller_extension_id, socket_id
                )));
            }
            handle
                .sender
                .send(Message::Text(data.into()))
                .map_err(|_| AppError::Other("Failed to send WebSocket message".to_string()))?;
            Ok(())
        } else {
            Err(AppError::Other(format!(
                "WebSocket socketId '{}' not found",
                socket_id
            )))
        }
    }

    /// Closes the socket with an optional close code and reason.
    /// Verifies the caller owns the socket.
    pub fn close(
        &self,
        socket_id: &str,
        code: Option<u16>,
        reason: Option<String>,
        caller_extension_id: &str,
    ) -> Result<(), AppError> {
        let mut guard = self
            .sockets
            .lock()
            .map_err(|_| AppError::Other("Lock failed".to_string()))?;
        if let Some(handle) = guard.remove(socket_id) {
            if handle.owner_extension_id != caller_extension_id {
                // Put it back — not this extension's socket
                guard.insert(socket_id.to_string(), handle);
                return Err(AppError::Other(format!(
                    "Extension '{}' is not the owner of socket '{}'",
                    caller_extension_id, socket_id
                )));
            }
            let close_frame = code.map(|c| CloseFrame {
                code: CloseCode::from(c),
                reason: reason.unwrap_or_default().into(),
            });
            let _ = handle.sender.send(Message::Close(close_frame));
            handle.task.abort();
            Ok(())
        } else {
            // Socket already closed or missing — idempotent
            Ok(())
        }
    }
}
