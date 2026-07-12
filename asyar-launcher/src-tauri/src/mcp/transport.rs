use crate::mcp::sidecar::{resolve_command_with_probe, system_command_exists, ResolvedCommand};
use crate::mcp::types::{McpClientError, McpTransportSpec};
use async_trait::async_trait;
use std::path::PathBuf;
// `Mutex` isn't used by production code in this module anymore (the old
// Mutex-based `SidecarPath` is gone), but the RED test fixtures below rely
// on it being in scope via `use super::*;`.
#[allow(unused_imports)]
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

/// Resolves a bundled runtime name (`"bun"`, `"uv"`) to its installed binary
/// path. Implementations should look this up fresh on every call rather
/// than caching it, so a runtime that finishes downloading mid-session is
/// picked up on the very next `connect()` retry.
pub trait RuntimeResolver: Send + Sync {
    fn resolve(&self, name: &str) -> Option<PathBuf>;
}

/// Harmless default used by `StdioTransportFactory::default()` — resolves
/// nothing, matching the old Mutex-based default of empty sidecar paths.
struct NoRuntimeResolver;

impl RuntimeResolver for NoRuntimeResolver {
    fn resolve(&self, _name: &str) -> Option<PathBuf> {
        None
    }
}

pub struct StdioTransportFactory {
    runtime_resolver: Arc<dyn RuntimeResolver>,
}

impl StdioTransportFactory {
    pub fn new(runtime_resolver: Arc<dyn RuntimeResolver>) -> Self {
        Self { runtime_resolver }
    }
}

impl Default for StdioTransportFactory {
    fn default() -> Self {
        Self::new(Arc::new(NoRuntimeResolver))
    }
}

/// Pure core of stdio command resolution: resolves `command`/`args` against
/// `runtime_resolver` (bun/uv, looked up fresh on every call) and `probe`
/// (system PATH availability), delegating the actual rewrite rules to
/// `sidecar::resolve_command_with_probe`. `StdioTransportFactory::connect`
/// delegates to this; tests exercise it directly so they can inject a fake
/// resolver/probe without touching the real filesystem or spawning a
/// process.
///
/// Only resolves the ONE runtime `command` could actually need (via
/// `sidecar::runtime_for_command` — the same single source of truth
/// `install::required_runtime_for_command_with_probe` uses), instead of
/// unconditionally resolving both bun and uv on every call — halving the
/// filesystem lookups `RuntimeResolver::resolve` does per connect attempt.
pub fn resolve_stdio_command<F: Fn(&str) -> bool>(
    command: &str,
    args: &[String],
    runtime_resolver: &dyn RuntimeResolver,
    probe: F,
) -> Result<ResolvedCommand, McpClientError> {
    let needed = crate::mcp::sidecar::runtime_for_command(command);
    let bundled_bun = (needed == Some("bun"))
        .then(|| runtime_resolver.resolve("bun"))
        .flatten();
    let bundled_uv = (needed == Some("uv"))
        .then(|| runtime_resolver.resolve("uv"))
        .flatten();
    resolve_command_with_probe(
        command,
        args,
        bundled_bun.as_ref(),
        bundled_uv.as_ref(),
        probe,
    )
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
                let resolved = resolve_stdio_command(
                    command,
                    args,
                    self.runtime_resolver.as_ref(),
                    system_command_exists,
                )?;
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
    /// MCP Streamable HTTP session id, captured from the server's response
    /// header after `initialize` and echoed on every subsequent request so the
    /// server can route follow-up calls (`tools/list`, `tools/call`) to the
    /// same logical session.
    session_id: std::sync::Mutex<Option<String>>,
}

impl HttpTransport {
    /// POST `line` to the server and return the response frames.
    /// Returns an empty vec for notification POSTs (caller discards).
    ///
    /// For `text/event-stream` responses, frames are extracted incrementally
    /// from the byte stream so large SSE payloads don't require full buffering.
    /// For all other content types, the response body is read in full.
    async fn do_post(&self, line: &str) -> Result<Vec<String>, McpClientError> {
        let mut req = self.client.post(self.url.clone());
        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(sid) = self.session_id.lock().unwrap().as_ref() {
            req = req.header("Mcp-Session-Id", sid.as_str());
        }
        let response = req
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2025-06-18")
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

        if let Some(sid) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
        {
            *self.session_id.lock().unwrap() = Some(sid.to_string());
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();

        if content_type.contains("text/event-stream") {
            parse_sse_stream(response).await
        } else {
            let body = response
                .text()
                .await
                .map_err(|e| McpClientError::Transport(e.to_string()))?;
            Ok(vec![body])
        }
    }
}

/// Parse an SSE response stream incrementally, extracting `data:` lines.
/// Each `data:` line becomes one entry in the returned vec.
async fn parse_sse_stream(response: reqwest::Response) -> Result<Vec<String>, McpClientError> {
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut frames: Vec<String> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| McpClientError::Transport(format!("stream read: {e}")))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Extract all complete lines from the buffer
        while let Some(idx) = buffer.find('\n') {
            let line = buffer[..idx].trim_end_matches('\r').to_string();
            buffer.drain(..=idx);
            if let Some(rest) = line.strip_prefix("data: ") {
                frames.push(rest.to_string());
            } else if let Some(rest) = line.strip_prefix("data:") {
                frames.push(rest.to_string());
            }
            // Ignore event:, id:, retry:, and blank lines
        }
    }

    // Handle a trailing unterminated data line (no final newline)
    let trailing = buffer.trim();
    if let Some(rest) = trailing
        .strip_prefix("data: ")
        .or_else(|| trailing.strip_prefix("data:"))
    {
        if !rest.is_empty() {
            frames.push(rest.to_string());
        }
    }

    Ok(frames)
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
                    session_id: std::sync::Mutex::new(None),
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
#[derive(Default)]
pub struct MultiTransportFactory {
    stdio: StdioTransportFactory,
    http: HttpTransportFactory,
}

impl MultiTransportFactory {
    /// `runtime_resolver` feeds the wrapped `StdioTransportFactory`'s
    /// bun/uv lookups (see `RuntimeResolver`).
    pub fn new(runtime_resolver: Arc<dyn RuntimeResolver>) -> Self {
        Self {
            stdio: StdioTransportFactory::new(runtime_resolver),
            http: HttpTransportFactory::new(),
        }
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

    // 7. http_sse_streams_multiple_responses_in_order
    #[tokio::test]
    async fn http_sse_streams_multiple_responses_in_order() {
        let mut server = mockito::Server::new_async().await;
        let sse_body = "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"first\":true}}\n\
                        \n\
                        data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"second\":true}}\n\
                        \n";
        let mock = server
            .mock("POST", "/mcp")
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(sse_body)
            .expect(1)
            .create_async()
            .await;

        let factory = HttpTransportFactory::new();
        let spec = McpTransportSpec::Http {
            url: format!("{}/mcp", server.url()),
            headers: BTreeMap::new(),
        };
        let mut transport = factory.connect(&spec).await.expect("connect");

        transport
            .send(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#)
            .await
            .expect("send");

        let frame1 = transport.recv().await.expect("recv 1");
        assert!(frame1.is_some(), "expected first SSE frame");
        assert!(
            frame1.unwrap().contains("\"first\""),
            "first frame should contain 'first'"
        );

        let frame2 = transport.recv().await.expect("recv 2");
        assert!(frame2.is_some(), "expected second SSE frame");
        assert!(
            frame2.unwrap().contains("\"second\""),
            "second frame should contain 'second'"
        );

        let frame3 = transport.recv().await.expect("recv 3");
        assert!(frame3.is_none(), "expected no more frames");

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn http_send_includes_streamable_http_headers_and_echoes_session_id() {
        let mut server = mockito::Server::new_async().await;

        let first = server
            .mock("POST", "/mcp")
            .match_header("accept", "application/json, text/event-stream")
            .match_header("mcp-protocol-version", "2025-06-18")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_header("mcp-session-id", "sess-abc-123")
            .with_body(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#)
            .expect(1)
            .create_async()
            .await;

        let second = server
            .mock("POST", "/mcp")
            .match_header("mcp-session-id", "sess-abc-123")
            .match_header("accept", "application/json, text/event-stream")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"jsonrpc":"2.0","id":2,"result":{}}"#)
            .expect(1)
            .create_async()
            .await;

        let factory = HttpTransportFactory::new();
        let spec = McpTransportSpec::Http {
            url: format!("{}/mcp", server.url()),
            headers: BTreeMap::new(),
        };
        let mut transport = factory.connect(&spec).await.expect("connect");

        transport
            .send(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#)
            .await
            .expect("first send");
        let _ = transport.recv().await.expect("recv 1");

        transport
            .send(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#)
            .await
            .expect("second send");
        let _ = transport.recv().await.expect("recv 2");

        first.assert_async().await;
        second.assert_async().await;
    }

    // ── RED: StdioTransportFactory resolves bun/uv via an injected runtime
    // resolver, not the startup-populated SidecarPath Mutex ─────────────────
    //
    // `RuntimeResolver`, `StdioTransportFactory::new`, and
    // `resolve_stdio_command` don't exist yet — production code must add
    // them. The crate fails to compile until then; that is the expected RED
    // state for these three tests.

    struct NoopRuntimeResolver;

    impl super::RuntimeResolver for NoopRuntimeResolver {
        fn resolve(&self, _name: &str) -> Option<PathBuf> {
            None
        }
    }

    #[tokio::test]
    async fn stdio_transport_factory_new_accepts_a_runtime_resolver_and_still_rejects_empty_command(
    ) {
        let factory = super::StdioTransportFactory::new(Arc::new(NoopRuntimeResolver));
        let spec = McpTransportSpec::Stdio {
            command: "".to_string(),
            args: vec![],
            env: BTreeMap::new(),
            cwd: None,
        };

        let result = factory.connect(&spec).await;
        match result {
            Err(McpClientError::Transport(_)) => {}
            Err(e) => panic!(
                "expected Transport error for empty command via the new resolver-based constructor, got error: {e}"
            ),
            Ok(_) => panic!(
                "expected Transport error for empty command via the new resolver-based constructor, got Ok"
            ),
        }
    }

    struct FixedRuntimeResolver {
        bun: Option<PathBuf>,
    }

    impl super::RuntimeResolver for FixedRuntimeResolver {
        fn resolve(&self, name: &str) -> Option<PathBuf> {
            if name == "bun" {
                self.bun.clone()
            } else {
                None
            }
        }
    }

    #[test]
    fn resolve_stdio_command_resolves_bun_via_injected_runtime_resolver_when_not_on_path() {
        let bun_path = PathBuf::from("/runtimes/bun/1.2.0/bun");
        let resolver = FixedRuntimeResolver {
            bun: Some(bun_path.clone()),
        };
        let args = vec![
            "@modelcontextprotocol/server-filesystem".to_string(),
            "/tmp".to_string(),
        ];

        let result = super::resolve_stdio_command("npx", &args, &resolver, |_| false)
            .expect("resolve via injected runtime resolver");

        assert_eq!(result.program, bun_path);
        assert_eq!(
            result.args,
            vec![
                "x".to_string(),
                "@modelcontextprotocol/server-filesystem".to_string(),
                "/tmp".to_string()
            ]
        );
    }

    struct SwitchableRuntimeResolver {
        bun: Mutex<Option<PathBuf>>,
    }

    impl super::RuntimeResolver for SwitchableRuntimeResolver {
        fn resolve(&self, name: &str) -> Option<PathBuf> {
            if name == "bun" {
                self.bun.lock().unwrap().clone()
            } else {
                None
            }
        }
    }

    #[test]
    fn resolve_stdio_command_reflects_runtime_resolver_changes_between_calls_so_a_mid_session_download_is_picked_up_on_retry(
    ) {
        let resolver = SwitchableRuntimeResolver {
            bun: Mutex::new(None),
        };
        let args = vec!["some-package".to_string()];

        // Before the download finishes: no cached success from a prior call.
        let before = super::resolve_stdio_command("npx", &args, &resolver, |_| false);
        match before {
            Err(McpClientError::Transport(msg)) => {
                assert!(
                    msg.contains("npx not found on PATH"),
                    "error must mention npx not found, got: {msg}"
                );
            }
            other => panic!("expected Transport error before download completes, got: {other:?}"),
        }

        // Simulate the runtime finishing its download mid-session.
        *resolver.bun.lock().unwrap() = Some(PathBuf::from("/runtimes/bun/1.2.0/bun"));

        // Same resolver instance, called again: must reflect the update
        // fresh, not a stale "not found" snapshot from the first call.
        let after = super::resolve_stdio_command("npx", &args, &resolver, |_| false)
            .expect("resolve must succeed once the runtime resolver reports bun installed");
        assert_eq!(after.program, PathBuf::from("/runtimes/bun/1.2.0/bun"));
    }

    // ── RED (fix #8): resolve_stdio_command must only resolve the ONE
    // runtime the command actually needs, not both bun and uv unconditionally.

    struct RecordingRuntimeResolver {
        calls: Mutex<Vec<String>>,
        bun: Option<PathBuf>,
    }

    impl super::RuntimeResolver for RecordingRuntimeResolver {
        fn resolve(&self, name: &str) -> Option<PathBuf> {
            self.calls.lock().unwrap().push(name.to_string());
            if name == "bun" {
                self.bun.clone()
            } else {
                None
            }
        }
    }

    #[test]
    fn resolve_stdio_command_only_resolves_the_runtime_the_command_actually_needs() {
        let resolver = RecordingRuntimeResolver {
            calls: Mutex::new(vec![]),
            bun: Some(PathBuf::from("/runtimes/bun/1.2.0/bun")),
        };
        let args = vec!["some-package".to_string()];

        let _ = super::resolve_stdio_command("npx", &args, &resolver, |_| false);

        let calls = resolver.calls.lock().unwrap();
        assert_eq!(
            *calls,
            vec!["bun".to_string()],
            "an npx command must only resolve 'bun', never also 'uv'"
        );
    }

    #[test]
    fn resolve_stdio_command_resolves_neither_runtime_for_an_unmapped_command() {
        let resolver = RecordingRuntimeResolver {
            calls: Mutex::new(vec![]),
            bun: None,
        };
        let args: Vec<String> = vec![];

        let _ = super::resolve_stdio_command("my-custom-server", &args, &resolver, |_| false);

        assert!(
            resolver.calls.lock().unwrap().is_empty(),
            "an unmapped command must not resolve any bundled runtime"
        );
    }
}
