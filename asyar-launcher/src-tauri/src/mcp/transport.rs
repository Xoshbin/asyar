use crate::mcp::sidecar::resolve_command;
use crate::mcp::types::{McpClientError, McpTransportSpec};
use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[async_trait]
pub trait Transport: Send {
    async fn send(&mut self, line: &str) -> Result<(), McpClientError>;
    async fn recv(&mut self) -> Result<Option<String>, McpClientError>;
    async fn close(&mut self) -> Result<(), McpClientError>;
}

#[async_trait]
pub trait TransportFactory: Send + Sync {
    async fn connect(&self, spec: &McpTransportSpec) -> Result<Box<dyn Transport>, McpClientError>;
}

/// Shared mutable sidecar path — populated lazily in `setup_app` once the
/// `AppHandle` is available, then read by the factory on every `connect` call.
pub type SidecarPath = Arc<Mutex<Option<PathBuf>>>;

pub struct StdioTransportFactory {
    pub bundled_bun: SidecarPath,
    pub bundled_uv: SidecarPath,
}

impl Default for StdioTransportFactory {
    fn default() -> Self {
        Self {
            bundled_bun: Arc::new(Mutex::new(None)),
            bundled_uv: Arc::new(Mutex::new(None)),
        }
    }
}

pub struct HttpTransportFactory {
    client: reqwest::Client,
}

impl HttpTransportFactory {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }
}

impl Default for HttpTransportFactory {
    fn default() -> Self {
        Self::new()
    }
}

// ── Stdio transport ───────────────────────────────────────────────────────────

struct StdioTransport {
    stdin: tokio::io::BufWriter<tokio::process::ChildStdin>,
    lines: tokio_util::codec::FramedRead<
        tokio::io::BufReader<tokio::process::ChildStdout>,
        tokio_util::codec::LinesCodec,
    >,
    _child: tokio::process::Child,
}

#[async_trait]
impl Transport for StdioTransport {
    async fn send(&mut self, line: &str) -> Result<(), McpClientError> {
        use tokio::io::AsyncWriteExt;
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await?;
        Ok(())
    }

    async fn recv(&mut self) -> Result<Option<String>, McpClientError> {
        use futures_util::StreamExt;
        match self.lines.next().await {
            None => Ok(None),
            Some(Ok(line)) => Ok(Some(line)),
            Some(Err(e)) => Err(McpClientError::Transport(e.to_string())),
        }
    }

    async fn close(&mut self) -> Result<(), McpClientError> {
        Ok(())
    }
}

#[async_trait]
impl TransportFactory for StdioTransportFactory {
    async fn connect(&self, spec: &McpTransportSpec) -> Result<Box<dyn Transport>, McpClientError> {
        match spec {
            McpTransportSpec::Stdio {
                command,
                args,
                env,
                cwd,
            } => {
                if command.is_empty() {
                    return Err(McpClientError::Transport("empty command".to_string()));
                }
                let bun_lock = self.bundled_bun.lock().unwrap();
                let uv_lock = self.bundled_uv.lock().unwrap();
                let resolved = resolve_command(
                    command,
                    args,
                    bun_lock.as_ref(),
                    uv_lock.as_ref(),
                )?;
                drop(bun_lock);
                drop(uv_lock);
                use std::process::Stdio;
                let mut cmd = tokio::process::Command::new(&resolved.program);
                cmd.args(&resolved.args)
                    .envs(env)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .kill_on_drop(true);
                if let Some(dir) = cwd {
                    cmd.current_dir(dir);
                }
                let mut child = cmd
                    .spawn()
                    .map_err(|e| McpClientError::Transport(e.to_string()))?;
                let stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| McpClientError::Transport("no stdin".to_string()))?;
                let stdout = child
                    .stdout
                    .take()
                    .ok_or_else(|| McpClientError::Transport("no stdout".to_string()))?;
                let lines = tokio_util::codec::FramedRead::new(
                    tokio::io::BufReader::new(stdout),
                    tokio_util::codec::LinesCodec::new(),
                );
                Ok(Box::new(StdioTransport {
                    stdin: tokio::io::BufWriter::new(stdin),
                    lines,
                    _child: child,
                }))
            }
            McpTransportSpec::Http { .. } => Err(McpClientError::Transport(
                "StdioTransportFactory cannot handle Http spec".to_string(),
            )),
        }
    }
}

// ── HTTP transport ────────────────────────────────────────────────────────────

struct HttpTransport {
    client: reqwest::Client,
    url: reqwest::Url,
    headers: std::collections::BTreeMap<String, String>,
    /// Buffered response frames available to `recv()`. Each `send()` of a
    /// non-notification request drains the previous state and fills this queue
    /// with the frames from the fresh POST response. Notifications POST but
    /// don't enqueue anything here so `recv()` returns `None` for them.
    buf: std::collections::VecDeque<String>,
    closed: bool,
}

impl HttpTransport {
    /// POST `line` to the server and return the response frames.
    /// Returns an empty vec for notification POSTs (caller discards).
    async fn do_post(&self, line: &str) -> Result<Vec<String>, McpClientError> {
        let mut req = self.client.post(self.url.clone());
        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let response = req
            .header("content-type", "application/json")
            .body(line.to_string())
            .send()
            .await
            .map_err(|e| McpClientError::Transport(e.to_string()))?;

        if !response.status().is_success() {
            return Err(McpClientError::Transport(format!(
                "HTTP {} {}",
                response.status().as_u16(),
                response.status().canonical_reason().unwrap_or("")
            )));
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let body = response
            .text()
            .await
            .map_err(|e| McpClientError::Transport(e.to_string()))?;

        if content_type.contains("text/event-stream") {
            let frames: Vec<String> = body
                .lines()
                .filter_map(|l| l.strip_prefix("data: ").map(|d| d.to_string()))
                .collect();
            Ok(frames)
        } else {
            Ok(vec![body])
        }
    }
}

#[async_trait]
impl Transport for HttpTransport {
    async fn send(&mut self, line: &str) -> Result<(), McpClientError> {
        let is_notification = serde_json::from_str::<serde_json::Value>(line)
            .map(|v| v.get("id").is_none())
            .unwrap_or(false);

        // Always POST — real MCP HTTP servers expect every message, including
        // notifications/initialized. For notifications we discard the response
        // body so `recv()` does not surface a spurious frame.
        let frames = self.do_post(line).await?;
        if !is_notification {
            self.buf.clear();
            for frame in frames {
                self.buf.push_back(frame);
            }
        }
        Ok(())
    }

    async fn recv(&mut self) -> Result<Option<String>, McpClientError> {
        Ok(self.buf.pop_front())
    }

    async fn close(&mut self) -> Result<(), McpClientError> {
        self.closed = true;
        self.buf.clear();
        Ok(())
    }
}

#[async_trait]
impl TransportFactory for HttpTransportFactory {
    async fn connect(&self, spec: &McpTransportSpec) -> Result<Box<dyn Transport>, McpClientError> {
        match spec {
            McpTransportSpec::Http { url, headers } => {
                let parsed = reqwest::Url::parse(url)
                    .map_err(|e| McpClientError::Transport(e.to_string()))?;
                Ok(Box::new(HttpTransport {
                    client: self.client.clone(),
                    url: parsed,
                    headers: headers.clone(),
                    buf: std::collections::VecDeque::new(),
                    closed: false,
                }))
            }
            McpTransportSpec::Stdio { .. } => Err(McpClientError::Transport(
                "HttpTransportFactory cannot handle Stdio spec".to_string(),
            )),
        }
    }
}

// ── Multi-transport factory ───────────────────────────────────────────────────

/// Dispatches to `StdioTransportFactory` or `HttpTransportFactory` based on
/// the `kind` discriminant of the `McpTransportSpec`.
pub struct MultiTransportFactory {
    stdio: StdioTransportFactory,
    http: HttpTransportFactory,
}

impl MultiTransportFactory {
    pub fn new() -> Self {
        Self {
            stdio: StdioTransportFactory::default(),
            http: HttpTransportFactory::new(),
        }
    }

    /// Return the shared sidecar path handles so callers (e.g. `setup_app`)
    /// can populate them lazily after the `AppHandle` becomes available.
    pub fn sidecar_handles(&self) -> (SidecarPath, SidecarPath) {
        (
            Arc::clone(&self.stdio.bundled_bun),
            Arc::clone(&self.stdio.bundled_uv),
        )
    }
}

impl Default for MultiTransportFactory {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TransportFactory for MultiTransportFactory {
    async fn connect(&self, spec: &McpTransportSpec) -> Result<Box<dyn Transport>, McpClientError> {
        match spec {
            McpTransportSpec::Stdio { .. } => self.stdio.connect(spec).await,
            McpTransportSpec::Http { .. } => self.http.connect(spec).await,
        }
    }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

#[cfg(test)]
pub(crate) struct ServerSide {
    tx: tokio::sync::mpsc::UnboundedSender<String>,
    rx: tokio::sync::mpsc::UnboundedReceiver<String>,
}

#[cfg(test)]
impl ServerSide {
    pub async fn recv_line(&mut self) -> Option<String> {
        self.rx.recv().await
    }

    pub async fn send_line(&mut self, line: &str) {
        let _ = self.tx.send(line.to_string());
    }
}

#[cfg(test)]
struct DuplexTransport {
    tx: tokio::sync::mpsc::UnboundedSender<String>,
    rx: tokio::sync::mpsc::UnboundedReceiver<String>,
}

#[cfg(test)]
#[async_trait]
impl Transport for DuplexTransport {
    async fn send(&mut self, line: &str) -> Result<(), McpClientError> {
        self.tx
            .send(line.to_string())
            .map_err(|e| McpClientError::Transport(e.to_string()))
    }

    async fn recv(&mut self) -> Result<Option<String>, McpClientError> {
        Ok(self.rx.recv().await)
    }

    async fn close(&mut self) -> Result<(), McpClientError> {
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn duplex_pair() -> (Box<dyn Transport>, ServerSide) {
    // client→server channel
    let (c2s_tx, c2s_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    // server→client channel
    let (s2c_tx, s2c_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let transport = Box::new(DuplexTransport {
        tx: c2s_tx,
        rx: s2c_rx,
    });
    let server = ServerSide {
        tx: s2c_tx,
        rx: c2s_rx,
    };
    (transport, server)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    // 4. http_transport_posts_notification_and_discards_response
    #[tokio::test]
    async fn http_transport_posts_notification_and_discards_response() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/mcp")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"jsonrpc":"2.0","id":null,"result":{}}"#)
            .expect(1)
            .create_async()
            .await;

        let factory = HttpTransportFactory::new();
        let spec = McpTransportSpec::Http {
            url: format!("{}/mcp", server.url()),
            headers: BTreeMap::new(),
        };
        let mut transport = factory.connect(&spec).await.expect("connect");

        // Send a notification (no id field) — must POST but discard response
        transport
            .send(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
            .await
            .expect("send notification");

        // recv must NOT return the discarded notification response
        let received = transport.recv().await.expect("recv");
        assert!(
            received.is_none(),
            "recv after notification must return None, got: {received:?}"
        );

        mock.assert_async().await;
    }

    // 5. http_transport_does_two_distinct_posts_for_two_send_calls
    #[tokio::test]
    async fn http_transport_does_two_distinct_posts_for_two_send_calls() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/mcp")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"jsonrpc":"2.0","id":1,"result":{"first":true}}"#)
            .expect(1)
            .create_async()
            .await;
        let mock2 = server
            .mock("POST", "/mcp")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"jsonrpc":"2.0","id":2,"result":{"second":true}}"#)
            .expect(1)
            .create_async()
            .await;

        let factory = HttpTransportFactory::new();
        let spec = McpTransportSpec::Http {
            url: format!("{}/mcp", server.url()),
            headers: BTreeMap::new(),
        };
        let mut transport = factory.connect(&spec).await.expect("connect");

        // First send + recv pair
        transport
            .send(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#)
            .await
            .expect("send 1");
        let r1 = transport.recv().await.expect("recv 1");
        assert!(r1.is_some(), "recv 1 must return something");
        let r1_str = r1.unwrap();
        assert!(
            r1_str.contains("\"first\""),
            "recv 1 must return first response, got: {r1_str}"
        );

        // Second send + recv pair — must POST again, not reuse stale buffer
        transport
            .send(r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{}}"#)
            .await
            .expect("send 2");
        let r2 = transport.recv().await.expect("recv 2");
        assert!(r2.is_some(), "recv 2 must return something");
        let r2_str = r2.unwrap();
        assert!(
            r2_str.contains("\"second\""),
            "recv 2 must return second response, got: {r2_str}"
        );

        mock.assert_async().await;
        mock2.assert_async().await;
    }

    // 6. multi_transport_factory_dispatches_stdio_to_stdio_factory_and_http_to_http_factory
    #[tokio::test]
    async fn multi_transport_factory_dispatches_stdio_to_stdio_factory_and_http_to_http_factory() {
        let factory = MultiTransportFactory::default();

        // Stdio path — empty command proves StdioTransportFactory was dispatched
        let stdio_spec = McpTransportSpec::Stdio {
            command: "".to_string(),
            args: vec![],
            env: BTreeMap::new(),
            cwd: None,
        };
        let stdio_result = factory.connect(&stdio_spec).await;
        match stdio_result {
            Err(McpClientError::Transport(msg)) => {
                assert!(
                    msg.contains("empty command"),
                    "expected 'empty command' error from stdio path, got: {msg}"
                );
            }
            Err(e) => panic!("expected Transport error from stdio path, got: {e}"),
            Ok(_) => panic!("expected error from stdio path, got Ok"),
        }

        // Http path — invalid URL proves HttpTransportFactory was dispatched
        let http_spec = McpTransportSpec::Http {
            url: "not a url".to_string(),
            headers: BTreeMap::new(),
        };
        let http_result = factory.connect(&http_spec).await;
        match http_result {
            Err(McpClientError::Transport(_)) => {}
            Err(e) => panic!("expected Transport error from http path, got: {e}"),
            Ok(_) => panic!("expected error from http path, got Ok"),
        }
    }

    // 1. stdio_factory_rejects_empty_command_with_validation_error
    #[tokio::test]
    async fn stdio_factory_rejects_empty_command_with_validation_error() {
        let factory = StdioTransportFactory::default();
        let spec = McpTransportSpec::Stdio {
            command: "".to_string(),
            args: vec![],
            env: BTreeMap::new(),
            cwd: None,
        };
        let result = factory.connect(&spec).await;
        match result {
            Err(McpClientError::Transport(_)) => {}
            Err(e) => panic!("expected Transport error, got error: {e}"),
            Ok(_) => panic!("expected Transport error, got Ok"),
        }
    }

    // 2. http_factory_rejects_invalid_url_with_validation_error
    #[tokio::test]
    async fn http_factory_rejects_invalid_url_with_validation_error() {
        let factory = HttpTransportFactory::new();
        let spec = McpTransportSpec::Http {
            url: "not a url".to_string(),
            headers: BTreeMap::new(),
        };
        let result = factory.connect(&spec).await;
        match result {
            Err(McpClientError::Transport(_)) => {}
            Err(e) => panic!("expected Transport error, got error: {e}"),
            Ok(_) => panic!("expected Transport error, got Ok"),
        }
    }

    // 3. duplex_transport_helper_round_trips_lines
    #[tokio::test]
    async fn duplex_transport_helper_round_trips_lines() {
        let (mut transport, mut server) = duplex_pair();

        // Client → Server
        transport.send("hello from client").await.expect("send");
        let received = server.recv_line().await.expect("server recv_line");
        assert_eq!(received, "hello from client");

        // Server → Client
        server.send_line("hello from server").await;
        let received = transport.recv().await.expect("transport recv");
        assert_eq!(received, Some("hello from server".to_string()));
    }
}
