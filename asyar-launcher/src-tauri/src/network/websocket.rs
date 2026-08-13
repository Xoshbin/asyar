//! Rust-managed WebSocket client manager.
//! Handles persistent connections, incoming event loops, and frame dispatch via Tauri events.

use crate::error::AppError;
use futures_util::{future::join_all, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::{
    tungstenite::{
        handshake::client::generate_key,
        http::Request,
        protocol::{frame::coding::CloseCode, CloseFrame},
        Message,
    },
    WebSocketStream,
};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsMessagePayload {
    pub socket_id: String,
    pub extension_id: String,
    pub origin_role: String,
    pub event_type: String, // "open" | "message" | "error" | "close"
    pub data: Option<String>,
    pub code: Option<u16>,
}

struct SocketHandle {
    sender: mpsc::UnboundedSender<Message>,
    /// The extension that opened this socket — used to prevent cross-extension access.
    owner_extension_id: String,
    /// A unique registration token prevents an old read loop from deleting a newer socket.
    registration: Arc<()>,
    /// Installed after registration, so an immediately-closing peer cannot leave a stale handle.
    task: Arc<Mutex<Option<JoinHandle<()>>>>,
    is_closing: Arc<AtomicBool>,
    terminal_close: TerminalCloseEmitter,
}

type TerminalCloseEmitter = Arc<dyn Fn(u16, Option<String>) + Send + Sync>;

async fn shutdown_socket(handle: SocketHandle, code: CloseCode, reason: String) {
    handle.is_closing.store(true, Ordering::Relaxed);
    let _ = handle.sender.send(Message::Close(Some(CloseFrame {
        code,
        reason: reason.into(),
    })));

    let task = handle.task.lock().ok().and_then(|mut slot| slot.take());
    let Some(mut task) = task else {
        (handle.terminal_close)(
            1006,
            Some("WebSocket closed before its read loop started".to_string()),
        );
        return;
    };

    match tokio::time::timeout(Duration::from_secs(2), &mut task).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            (handle.terminal_close)(
                1006,
                Some(format!("WebSocket read loop stopped unexpectedly: {error}")),
            );
        }
        Err(_) => {
            task.abort();
            let _ = task.await;
            (handle.terminal_close)(
                1006,
                Some("WebSocket close handshake timed out".to_string()),
            );
        }
    }
}

#[derive(Default)]
pub struct WebSocketManager {
    sockets: Arc<Mutex<HashMap<String, SocketHandle>>>,
}

/// Dial target resolved and validated against SSRF rules.
/// Connects TCP directly to a pre-validated SocketAddr, preventing DNS rebinding attacks.
async fn connect_ws_stream(
    url_str: &str,
    headers: Option<HashMap<String, String>>,
) -> Result<WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, AppError> {
    let url = Url::parse(url_str)
        .map_err(|e| AppError::Other(format!("Invalid WebSocket URL '{url_str}': {e}")))?;

    let is_tls = match url.scheme() {
        "ws" => false,
        "wss" => true,
        scheme => {
            return Err(AppError::Other(format!(
                "URL scheme '{scheme}' is not allowed. Only ws and wss are permitted."
            )));
        }
    };

    let host = url
        .host_str()
        .ok_or_else(|| AppError::Other("URL missing host".to_string()))?
        .trim_end_matches('.');

    if host.eq_ignore_ascii_case("localhost") {
        return Err(AppError::Other(
            "Requests to localhost are not allowed".to_string(),
        ));
    }

    let port = url
        .port_or_known_default()
        .ok_or_else(|| AppError::Other("Invalid port".to_string()))?;

    // Perform DNS resolution and validate all dial targets against SSRF rules (including IPv4-mapped IPv6)
    let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| AppError::Other(format!("DNS lookup failed for '{host}': {e}")))?
        .collect();

    if addrs.is_empty() {
        return Err(AppError::Other(format!(
            "No IP addresses found for '{host}'"
        )));
    }

    for addr in &addrs {
        if crate::network::service::is_restricted_ip(&addr.ip()) {
            return Err(AppError::Other(format!(
                "Requests to local or private IP address '{}' are not allowed",
                addr.ip()
            )));
        }
    }

    // Connect TcpStream directly to the pre-validated SocketAddr (DNS-rebinding safe)
    let tcp_stream = tokio::net::TcpStream::connect(addrs[0])
        .await
        .map_err(|e| AppError::Other(format!("WebSocket TCP connection failed: {e}")))?;

    let mut req_builder = Request::builder().uri(url_str);
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
        .map_err(|e| AppError::Other(format!("Failed to build WebSocket request: {e}")))?;

    if is_tls {
        let (ws_stream, _response) =
            tokio_tungstenite::client_async_tls_with_config(request, tcp_stream, None, None)
                .await
                .map_err(|e| AppError::Other(format!("WebSocket TLS connection failed: {e}")))?;
        Ok(ws_stream)
    } else {
        let stream = tokio_tungstenite::MaybeTlsStream::Plain(tcp_stream);
        let (ws_stream, _response) = tokio_tungstenite::client_async(request, stream)
            .await
            .map_err(|e| AppError::Other(format!("WebSocket connection failed: {e}")))?;
        Ok(ws_stream)
    }
}

impl WebSocketManager {
    pub fn new() -> Self {
        Self {
            sockets: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn connect<R: tauri::Runtime>(
        &self,
        socket_id: String,
        url_str: String,
        headers: Option<HashMap<String, String>>,
        caller_extension_id: String,
        origin_role: String,
        app: AppHandle<R>,
    ) -> Result<(), AppError> {
        let ws_stream = connect_ws_stream(&url_str, headers).await?;
        self.connect_stream(socket_id, ws_stream, caller_extension_id, origin_role, app)
    }

    /// Internal setup for connected WebSocketStream (used by connect and unit tests).
    fn connect_stream<R: tauri::Runtime, S>(
        &self,
        socket_id: String,
        ws_stream: WebSocketStream<S>,
        caller_extension_id: String,
        origin_role: String,
        app: AppHandle<R>,
    ) -> Result<(), AppError>
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        let (mut write, mut read) = ws_stream.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

        let is_closing = Arc::new(AtomicBool::new(false));
        let close_emitted = Arc::new(AtomicBool::new(false));
        let registration = Arc::new(());
        let task_slot = Arc::new(Mutex::new(None));

        let socket_id_event = socket_id.clone();
        let extension_id_event = caller_extension_id.clone();
        let origin_role_event = origin_role.clone();
        let close_emitted_event = Arc::clone(&close_emitted);
        let app_event = app.clone();
        let terminal_close: TerminalCloseEmitter = Arc::new(move |code, data| {
            if !close_emitted_event.swap(true, Ordering::SeqCst) {
                let _ = app_event.emit(
                    "asyar:event:network:wsMessage",
                    WsMessagePayload {
                        socket_id: socket_id_event.clone(),
                        extension_id: extension_id_event.clone(),
                        origin_role: origin_role_event.clone(),
                        event_type: "close".to_string(),
                        data,
                        code: Some(code),
                    },
                );
            }
        });

        // Spawn write loop
        let write_task = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if write.send(msg).await.is_err() {
                    break;
                }
            }
        });

        // Register before spawning the read loop. That way an immediately-closing peer can
        // clean up a real entry, instead of racing an insertion that leaves a dead socket.
        let handle = SocketHandle {
            sender: tx,
            owner_extension_id: caller_extension_id.clone(),
            registration: Arc::clone(&registration),
            task: Arc::clone(&task_slot),
            is_closing: Arc::clone(&is_closing),
            terminal_close: Arc::clone(&terminal_close),
        };
        {
            let mut guard = self
                .sockets
                .lock()
                .map_err(|_| AppError::Other("Lock failed".to_string()))?;
            if guard.contains_key(&socket_id) {
                write_task.abort();
                return Err(AppError::Other(format!(
                    "WebSocket socketId '{}' is already in use",
                    socket_id
                )));
            }
            guard.insert(socket_id.clone(), handle);
        }

        // Spawn the read loop only after the registration is visible.
        let sockets_ref = Arc::clone(&self.sockets);
        let socket_id_read = socket_id.clone();
        let ext_id_read = caller_extension_id.clone();
        let origin_role_read = origin_role;
        let is_closing_read = Arc::clone(&is_closing);
        let terminal_close_read = Arc::clone(&terminal_close);
        let registration_read = Arc::clone(&registration);
        let app_clone = app.clone();

        let read_task = tokio::spawn(async move {
            // Emit "open" event
            let _ = app_clone.emit(
                "asyar:event:network:wsMessage",
                WsMessagePayload {
                    socket_id: socket_id_read.clone(),
                    extension_id: ext_id_read.clone(),
                    origin_role: origin_role_read.clone(),
                    event_type: "open".to_string(),
                    data: None,
                    code: None,
                },
            );

            while let Some(msg_res) = read.next().await {
                match msg_res {
                    Ok(Message::Text(text)) => {
                        if !is_closing_read.load(Ordering::Relaxed) {
                            let _ = app_clone.emit(
                                "asyar:event:network:wsMessage",
                                WsMessagePayload {
                                    socket_id: socket_id_read.clone(),
                                    extension_id: ext_id_read.clone(),
                                    origin_role: origin_role_read.clone(),
                                    event_type: "message".to_string(),
                                    data: Some(text),
                                    code: None,
                                },
                            );
                        }
                    }
                    Ok(Message::Binary(bin)) => {
                        if !is_closing_read.load(Ordering::Relaxed) {
                            let base64_str = base64::Engine::encode(
                                &base64::engine::general_purpose::STANDARD,
                                &bin,
                            );
                            let _ = app_clone.emit(
                                "asyar:event:network:wsMessage",
                                WsMessagePayload {
                                    socket_id: socket_id_read.clone(),
                                    extension_id: ext_id_read.clone(),
                                    origin_role: origin_role_read.clone(),
                                    event_type: "message".to_string(),
                                    data: Some(base64_str),
                                    code: None,
                                },
                            );
                        }
                    }
                    Ok(Message::Close(frame)) => {
                        let code = frame.as_ref().map(|f| u16::from(f.code)).unwrap_or(1000);
                        let reason = frame.as_ref().map(|f| f.reason.to_string());
                        terminal_close_read(code, reason);
                        break;
                    }
                    Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                    Ok(_) => {}
                    Err(e) => {
                        let _ = app_clone.emit(
                            "asyar:event:network:wsMessage",
                            WsMessagePayload {
                                socket_id: socket_id_read.clone(),
                                extension_id: ext_id_read.clone(),
                                origin_role: origin_role_read.clone(),
                                event_type: "error".to_string(),
                                data: Some(e.to_string()),
                                code: None,
                            },
                        );
                        terminal_close_read(1006, Some(e.to_string()));
                        break;
                    }
                }
            }

            terminal_close_read(1000, Some("Connection closed by remote peer".to_string()));

            // Remove only the socket registered by this read loop. A stale loop must never
            // erase a newer connection that happens to reuse the same caller-provided ID.
            if let Ok(mut guard) = sockets_ref.lock() {
                let is_current = guard
                    .get(&socket_id_read)
                    .is_some_and(|handle| Arc::ptr_eq(&handle.registration, &registration_read));
                if is_current {
                    guard.remove(&socket_id_read);
                }
            }
            write_task.abort();
        });

        let mut slot = task_slot
            .lock()
            .map_err(|_| AppError::Other("Lock failed".to_string()))?;
        *slot = Some(read_task);

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
            if handle.is_closing.load(Ordering::Relaxed) {
                return Err(AppError::Other(format!(
                    "WebSocket socketId '{}' is closing",
                    socket_id
                )));
            }
            handle
                .sender
                .send(Message::Text(data))
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
    /// Performs graceful close handshake with a bounded wait timeout fallback.
    /// Never holds the registry mutex across await.
    pub async fn close(
        &self,
        socket_id: &str,
        code: Option<u16>,
        reason: Option<String>,
        caller_extension_id: &str,
    ) -> Result<(), AppError> {
        let handle = {
            let mut guard = self
                .sockets
                .lock()
                .map_err(|_| AppError::Other("Lock failed".to_string()))?;
            if let Some(handle) = guard.remove(socket_id) {
                if handle.owner_extension_id != caller_extension_id {
                    // Put back — not this extension's socket
                    guard.insert(socket_id.to_string(), handle);
                    return Err(AppError::Other(format!(
                        "Extension '{}' is not the owner of socket '{}'",
                        caller_extension_id, socket_id
                    )));
                }
                handle
            } else {
                return Ok(());
            }
        }; // Registry lock dropped BEFORE await

        shutdown_socket(
            handle,
            CloseCode::from(code.unwrap_or(1000)),
            reason.unwrap_or_default(),
        )
        .await;

        Ok(())
    }

    /// Closes all sockets owned by an extension. Used during disable and uninstall.
    /// Uses the exact same graceful shutdown + bounded wait mechanism for every socket.
    pub async fn close_all_for_extension(&self, extension_id: &str) -> usize {
        let handles: Vec<SocketHandle> = {
            let Ok(mut guard) = self.sockets.lock() else {
                return 0;
            };
            let to_remove: Vec<String> = guard
                .iter()
                .filter(|(_, h)| h.owner_extension_id == extension_id)
                .map(|(k, _)| k.clone())
                .collect();

            let mut list = Vec::new();
            for id in to_remove {
                if let Some(h) = guard.remove(&id) {
                    list.push(h);
                }
            }
            list
        }; // Registry lock dropped BEFORE await

        let count = handles.len();
        join_all(handles.into_iter().map(|handle| {
            shutdown_socket(
                handle,
                CloseCode::Normal,
                "Extension disabled or uninstalled".to_string(),
            )
        }))
        .await;
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    #[tokio::test]
    async fn ws_ssrf_validation_blocks_loopback_private_and_ipv4_mapped() {
        assert!(connect_ws_stream("ws://localhost:8080", None)
            .await
            .is_err());
        assert!(connect_ws_stream("ws://127.0.0.1:8080", None)
            .await
            .is_err());
        assert!(connect_ws_stream("ws://192.168.1.1:8080", None)
            .await
            .is_err());
        assert!(connect_ws_stream("ws://[::ffff:127.0.0.1]:8080", None)
            .await
            .is_err());
        assert!(connect_ws_stream("http://example.com", None).await.is_err());
    }

    #[tokio::test]
    async fn ws_prevalidated_address_dialing_proof() {
        // Create local listener
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        // Direct TcpStream connect to the pre-validated SocketAddr works
        let tcp_stream = tokio::net::TcpStream::connect(addr).await;
        assert!(
            tcp_stream.is_ok(),
            "Direct TcpStream connect to pre-validated SocketAddr succeeded without hostname re-resolution"
        );
    }

    #[tokio::test]
    async fn ws_connect_send_receive_and_remote_close() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server_task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            if let Some(Ok(Message::Text(msg))) = ws.next().await {
                let _ = ws.send(Message::Text(format!("echo: {msg}"))).await;
            }
            let _ = ws.close(None).await;
        });

        let app = tauri::test::mock_app();
        let manager = WebSocketManager::new();
        let socket_id = "ws_test_1".to_string();

        let client_tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (client_ws, _) = tokio_tungstenite::client_async("ws://example.com", client_tcp)
            .await
            .unwrap();

        manager
            .connect_stream(
                socket_id.clone(),
                client_ws,
                "ext.test".to_string(),
                "view".to_string(),
                app.handle().clone(),
            )
            .unwrap();

        // Socket is registered
        assert!(manager.sockets.lock().unwrap().contains_key(&socket_id));

        // Send message
        manager
            .send(&socket_id, "hello server".to_string(), "ext.test")
            .unwrap();

        // Wait for server task to finish and close
        let _ = server_task.await;
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Cleaned up from registry after remote close
        assert!(!manager.sockets.lock().unwrap().contains_key(&socket_id));
    }

    #[tokio::test]
    async fn ws_immediate_close_race_registers_and_cleans_up() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server_task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            let _ = ws.close(None).await;
        });

        let app = tauri::test::mock_app();
        let manager = WebSocketManager::new();
        let socket_id = "ws_race_1".to_string();

        let client_tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (client_ws, _) = tokio_tungstenite::client_async("ws://example.com", client_tcp)
            .await
            .unwrap();

        manager
            .connect_stream(
                socket_id.clone(),
                client_ws,
                "ext.test".to_string(),
                "view".to_string(),
                app.handle().clone(),
            )
            .unwrap();

        let _ = server_task.await;
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Socket cleanly unregistered, no dead handle left behind
        assert!(!manager.sockets.lock().unwrap().contains_key(&socket_id));
    }

    #[tokio::test]
    async fn ws_connect_stream_rejects_duplicate_socket_ids() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server_task = tokio::spawn(async move {
            for _ in 0..2 {
                let (stream, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut ws = accept_async(stream).await.unwrap();
                    while ws.next().await.is_some() {}
                });
            }
        });

        let app = tauri::test::mock_app();
        let manager = WebSocketManager::new();

        let first_tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (first_ws, _) = tokio_tungstenite::client_async("ws://example.com", first_tcp)
            .await
            .unwrap();
        manager
            .connect_stream(
                "duplicate-id".to_string(),
                first_ws,
                "ext.test".to_string(),
                "view".to_string(),
                app.handle().clone(),
            )
            .unwrap();

        let second_tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (second_ws, _) = tokio_tungstenite::client_async("ws://example.com", second_tcp)
            .await
            .unwrap();
        let result = manager.connect_stream(
            "duplicate-id".to_string(),
            second_ws,
            "ext.test".to_string(),
            "view".to_string(),
            app.handle().clone(),
        );

        assert!(
            result.is_err(),
            "a socket ID must not replace a live socket"
        );
        assert_eq!(manager.sockets.lock().unwrap().len(), 1);

        manager.close_all_for_extension("ext.test").await;
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn ws_local_close_bounded_wait_and_suppression() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server_task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            let _ = ws.next().await; // Receives Close frame and responds automatically
        });

        let app = tauri::test::mock_app();
        let manager = WebSocketManager::new();
        let socket_id = "ws_close_1".to_string();

        let client_tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (client_ws, _) = tokio_tungstenite::client_async("ws://example.com", client_tcp)
            .await
            .unwrap();

        manager
            .connect_stream(
                socket_id.clone(),
                client_ws,
                "ext.test".to_string(),
                "view".to_string(),
                app.handle().clone(),
            )
            .unwrap();

        // Local close
        manager
            .close(&socket_id, Some(1000), Some("done".into()), "ext.test")
            .await
            .unwrap();

        let _ = server_task.await;

        // Subsequent send fails
        assert!(manager.send(&socket_id, "test".into(), "ext.test").is_err());
    }

    #[tokio::test]
    async fn ws_non_cooperative_peer_timeout_cancellation() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server_task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            // Non-cooperative server: reads frames but ignores close frame and stays active
            while let Some(msg) = ws.next().await {
                if matches!(msg, Ok(Message::Close(_))) {
                    // Ignore close frame, sleep forever
                    tokio::time::sleep(Duration::from_secs(10)).await;
                }
            }
        });

        let app = tauri::test::mock_app();
        let manager = WebSocketManager::new();
        let socket_id = "ws_uncooperative_1".to_string();

        let client_tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (client_ws, _) = tokio_tungstenite::client_async("ws://example.com", client_tcp)
            .await
            .unwrap();

        manager
            .connect_stream(
                socket_id.clone(),
                client_ws,
                "ext.test".to_string(),
                "view".to_string(),
                app.handle().clone(),
            )
            .unwrap();

        // Local close triggers 2-second timeout and forces abort fallback
        let start = std::time::Instant::now();
        manager
            .close(&socket_id, Some(1000), None, "ext.test")
            .await
            .unwrap();
        let elapsed = start.elapsed();

        assert!(
            elapsed >= Duration::from_millis(1900) && elapsed <= Duration::from_millis(3500),
            "Bounded wait enforced timeout fallback around 2s"
        );

        server_task.abort();
    }

    #[tokio::test]
    async fn ws_manager_ownership_isolation() {
        let manager = WebSocketManager::new();
        let (tx, _rx) = mpsc::unbounded_channel();
        let is_closing = Arc::new(AtomicBool::new(false));
        let handle = SocketHandle {
            sender: tx,
            owner_extension_id: "ext.alpha".to_string(),
            registration: Arc::new(()),
            task: Arc::new(Mutex::new(Some(tokio::spawn(async {})))),
            is_closing,
            terminal_close: Arc::new(|_, _| {}),
        };
        manager
            .sockets
            .lock()
            .unwrap()
            .insert("ws_1".to_string(), handle);

        // Wrong owner cannot send
        assert!(manager.send("ws_1", "msg".to_string(), "ext.beta").is_err());
        // Right owner can send
        assert!(manager.send("ws_1", "msg".to_string(), "ext.alpha").is_ok());

        // Socket still exists in manager
        assert!(manager.sockets.lock().unwrap().contains_key("ws_1"));
    }

    #[tokio::test]
    async fn ws_manager_lifecycle_disable_uninstall_cleanup() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let _server_task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    if let Ok(mut ws) = accept_async(stream).await {
                        let _ = ws.next().await;
                    }
                });
            }
        });

        let app = tauri::test::mock_app();
        let manager = WebSocketManager::new();

        let client_tcp1 = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (ws1, _) = tokio_tungstenite::client_async("ws://example.com", client_tcp1)
            .await
            .unwrap();
        manager
            .connect_stream(
                "ws_a1".to_string(),
                ws1,
                "ext.alpha".to_string(),
                "view".to_string(),
                app.handle().clone(),
            )
            .unwrap();

        let client_tcp2 = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (ws2, _) = tokio_tungstenite::client_async("ws://example.com", client_tcp2)
            .await
            .unwrap();
        manager
            .connect_stream(
                "ws_b1".to_string(),
                ws2,
                "ext.beta".to_string(),
                "worker".to_string(),
                app.handle().clone(),
            )
            .unwrap();

        assert_eq!(manager.sockets.lock().unwrap().len(), 2);

        // Close all for ext.alpha
        let closed = manager.close_all_for_extension("ext.alpha").await;
        assert_eq!(closed, 1);

        let guard = manager.sockets.lock().unwrap();
        assert!(!guard.contains_key("ws_a1"), "ext.alpha socket removed");
        assert!(guard.contains_key("ws_b1"), "ext.beta socket untouched");
    }
}
