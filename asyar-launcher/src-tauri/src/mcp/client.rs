use crate::mcp::transport::Transport;
use crate::mcp::types::{McpCallResult, McpClientError, McpToolDescriptor};

pub struct McpClient {
    transport: Box<dyn Transport>,
    next_id: u64,
    server_info: Option<serde_json::Value>,
    capabilities: Option<serde_json::Value>,
}

impl McpClient {
    pub fn new(transport: Box<dyn Transport>) -> Self {
        Self {
            transport,
            next_id: 0,
            server_info: None,
            capabilities: None,
        }
    }

    fn alloc_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    async fn send_request(
        &mut self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<u64, McpClientError> {
        let id = self.alloc_id();
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let line = serde_json::to_string(&msg)?;
        self.transport.send(&line).await?;
        Ok(id)
    }

    async fn send_notification(
        &mut self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<(), McpClientError> {
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        let line = serde_json::to_string(&msg)?;
        self.transport.send(&line).await?;
        Ok(())
    }

    async fn recv_response(&mut self, expected_id: u64) -> Result<serde_json::Value, McpClientError> {
        loop {
            match self.transport.recv().await? {
                None => return Err(McpClientError::EarlyExit),
                Some(line) => {
                    let v: serde_json::Value = serde_json::from_str(&line)
                        .map_err(|_| McpClientError::Protocol(format!("malformed JSON: {line}")))?;
                    // Skip messages without an id (notifications from server)
                    match v.get("id") {
                        None => continue,
                        Some(id_val) => {
                            let id = id_val
                                .as_u64()
                                .ok_or_else(|| McpClientError::Protocol("non-integer id".to_string()))?;
                            if id != expected_id {
                                continue;
                            }
                        }
                    }
                    if let Some(err) = v.get("error") {
                        let code = err["code"]
                            .as_i64()
                            .ok_or_else(|| McpClientError::Protocol("missing error.code".to_string()))?;
                        let message = err["message"]
                            .as_str()
                            .unwrap_or("unknown")
                            .to_string();
                        return Err(McpClientError::Rpc { code, message });
                    }
                    return Ok(v["result"].clone());
                }
            }
        }
    }

    pub async fn initialize(&mut self) -> Result<(), McpClientError> {
        let id = self
            .send_request(
                "initialize",
                serde_json::json!({
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "Asyar",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                }),
            )
            .await?;

        let result = self.recv_response(id).await?;
        self.server_info = result.get("serverInfo").cloned();
        self.capabilities = result.get("capabilities").cloned();

        self.send_notification("notifications/initialized", serde_json::json!({}))
            .await?;

        Ok(())
    }

    pub async fn list_tools(&mut self) -> Result<Vec<McpToolDescriptor>, McpClientError> {
        let id = self
            .send_request("tools/list", serde_json::json!({}))
            .await?;
        let result = self.recv_response(id).await?;

        #[derive(serde::Deserialize)]
        struct WireToolDescriptor {
            name: String,
            description: Option<String>,
            #[serde(rename = "inputSchema")]
            input_schema: serde_json::Value,
        }

        #[derive(serde::Deserialize)]
        struct ListToolsResult {
            tools: Vec<WireToolDescriptor>,
        }

        let parsed: ListToolsResult = serde_json::from_value(result)
            .map_err(|e| McpClientError::Protocol(format!("tools/list result: {e}")))?;

        Ok(parsed
            .tools
            .into_iter()
            .map(|t| McpToolDescriptor {
                name: t.name,
                description: t.description,
                input_schema: t.input_schema,
            })
            .collect())
    }

    pub async fn call_tool(
        &mut self,
        name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpCallResult, McpClientError> {
        let id = self
            .send_request(
                "tools/call",
                serde_json::json!({
                    "name": name,
                    "arguments": arguments,
                }),
            )
            .await?;
        let result = self.recv_response(id).await?;

        #[derive(serde::Deserialize)]
        struct WireCallResult {
            content: serde_json::Value,
            #[serde(rename = "isError")]
            is_error: bool,
        }

        let parsed: WireCallResult = serde_json::from_value(result)
            .map_err(|e| McpClientError::Protocol(format!("tools/call result: {e}")))?;

        Ok(McpCallResult {
            content: parsed.content,
            is_error: parsed.is_error,
        })
    }

    pub async fn shutdown(mut self) -> Result<(), McpClientError> {
        self.transport.close().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::transport::duplex_pair;

    // ── Stdio path (using duplex_pair) ────────────────────────────────────────

    // 1. initialize_sends_correct_jsonrpc_envelope_and_parses_result
    #[tokio::test]
    async fn initialize_sends_correct_jsonrpc_envelope_and_parses_result() {
        let (transport, mut server) = duplex_pair();
        let mut client = McpClient::new(transport);

        let server_task = tokio::spawn(async move {
            let req = server.recv_line().await.unwrap();
            assert!(
                req.contains("\"method\":\"initialize\""),
                "missing initialize method: {req}"
            );
            assert!(
                req.contains("\"protocolVersion\""),
                "missing protocolVersion: {req}"
            );
            assert!(
                req.contains("\"clientInfo\""),
                "missing clientInfo: {req}"
            );
            assert!(req.contains("\"Asyar\""), "clientInfo name must be Asyar: {req}");
            server
                .send_line(
                    r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"x","version":"0"}}}"#,
                )
                .await;
            let _ = server.recv_line().await; // notifications/initialized
            server
        });

        client.initialize().await.unwrap();
        let _ = server_task.await.unwrap();
    }

    // 2. initialize_sends_initialized_notification_after_response
    #[tokio::test]
    async fn initialize_sends_initialized_notification_after_response() {
        let (transport, mut server) = duplex_pair();
        let mut client = McpClient::new(transport);

        let server_task = tokio::spawn(async move {
            let _init_req = server.recv_line().await.unwrap();
            server
                .send_line(
                    r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"x","version":"0"}}}"#,
                )
                .await;
            let notif = server.recv_line().await.unwrap();
            let v: serde_json::Value =
                serde_json::from_str(&notif).expect("notification must be valid json");
            assert_eq!(
                v["method"],
                "notifications/initialized",
                "notification method wrong: {notif}"
            );
            assert!(v.get("id").is_none(), "notification must not have id: {notif}");
            server
        });

        client.initialize().await.unwrap();
        let _ = server_task.await.unwrap();
    }

    // 3. initialize_returns_early_exit_when_stream_closes_before_response
    #[tokio::test]
    async fn initialize_returns_early_exit_when_stream_closes_before_response() {
        let (transport, mut server) = duplex_pair();
        let mut client = McpClient::new(transport);

        let server_task = tokio::spawn(async move {
            // Read the init request then drop server (closes stream)
            let _req = server.recv_line().await;
            drop(server);
        });

        let result = client.initialize().await;
        let _ = server_task.await;
        match result {
            Err(McpClientError::EarlyExit) => {}
            other => panic!("expected EarlyExit, got {other:?}"),
        }
    }

    // 4. initialize_maps_jsonrpc_error_object_to_rpc_error_variant
    #[tokio::test]
    async fn initialize_maps_jsonrpc_error_object_to_rpc_error_variant() {
        let (transport, mut server) = duplex_pair();
        let mut client = McpClient::new(transport);

        let server_task = tokio::spawn(async move {
            let _req = server.recv_line().await;
            server
                .send_line(
                    r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"x"}}"#,
                )
                .await;
            server
        });

        let result = client.initialize().await;
        let _ = server_task.await.unwrap();
        match result {
            Err(McpClientError::Rpc { code, message }) => {
                assert_eq!(code, -32601);
                assert_eq!(message, "x");
            }
            other => panic!("expected Rpc error, got {other:?}"),
        }
    }

    // 5. list_tools_parses_tools_array_into_descriptors
    #[tokio::test]
    async fn list_tools_parses_tools_array_into_descriptors() {
        let (transport, mut server) = duplex_pair();
        let mut client = McpClient::new(transport);

        let server_task = tokio::spawn(async move {
            // Handle initialize
            let _init = server.recv_line().await.unwrap();
            server
                .send_line(
                    r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"x","version":"0"}}}"#,
                )
                .await;
            let _ = server.recv_line().await; // notifications/initialized

            // Handle list_tools
            let _list_req = server.recv_line().await.unwrap();
            server
                .send_line(
                    r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"echo","description":"e","inputSchema":{"type":"object"}}]}}"#,
                )
                .await;
            server
        });

        client.initialize().await.unwrap();
        let tools = client.list_tools().await.unwrap();
        let _ = server_task.await.unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "echo");
        assert_eq!(tools[0].description, Some("e".to_string()));
    }

    // 6. list_tools_returns_protocol_error_on_malformed_json
    #[tokio::test]
    async fn list_tools_returns_protocol_error_on_malformed_json() {
        let (transport, mut server) = duplex_pair();
        let mut client = McpClient::new(transport);

        let server_task = tokio::spawn(async move {
            // Handle initialize
            let _init = server.recv_line().await.unwrap();
            server
                .send_line(
                    r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"x","version":"0"}}}"#,
                )
                .await;
            let _ = server.recv_line().await; // notifications/initialized

            // Send malformed JSON for list_tools
            let _list_req = server.recv_line().await.unwrap();
            server.send_line("not json").await;
            server
        });

        client.initialize().await.unwrap();
        let result = client.list_tools().await;
        let _ = server_task.await.unwrap();
        match result {
            Err(McpClientError::Protocol(_)) | Err(McpClientError::Json(_)) => {}
            other => panic!("expected Protocol or Json error, got {other:?}"),
        }
    }

    // 7. call_tool_round_trips_arguments_and_parses_content
    #[tokio::test]
    async fn call_tool_round_trips_arguments_and_parses_content() {
        let (transport, mut server) = duplex_pair();
        let mut client = McpClient::new(transport);

        let server_task = tokio::spawn(async move {
            // Handle initialize
            let _init = server.recv_line().await.unwrap();
            server
                .send_line(
                    r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"x","version":"0"}}}"#,
                )
                .await;
            let _ = server.recv_line().await; // notifications/initialized

            // Handle call_tool
            let call_req = server.recv_line().await.unwrap();
            assert!(call_req.contains("\"tools/call\""), "must call tools/call: {call_req}");
            assert!(call_req.contains("\"echo\""), "must include tool name echo: {call_req}");
            assert!(call_req.contains("\"x\""), "must include argument x: {call_req}");

            server
                .send_line(
                    r#"{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"ok"}],"isError":false}}"#,
                )
                .await;
            server
        });

        client.initialize().await.unwrap();
        let result = client
            .call_tool("echo", serde_json::json!({"x": 1}))
            .await
            .unwrap();
        let _ = server_task.await.unwrap();
        assert!(!result.is_error);
    }

    // 8. call_tool_returns_rpc_error_when_server_returns_error_object
    #[tokio::test]
    async fn call_tool_returns_rpc_error_when_server_returns_error_object() {
        let (transport, mut server) = duplex_pair();
        let mut client = McpClient::new(transport);

        let server_task = tokio::spawn(async move {
            // Handle initialize
            let _init = server.recv_line().await.unwrap();
            server
                .send_line(
                    r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"x","version":"0"}}}"#,
                )
                .await;
            let _ = server.recv_line().await; // notifications/initialized

            // Return error for call_tool
            let _call_req = server.recv_line().await.unwrap();
            server
                .send_line(
                    r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"boom"}}"#,
                )
                .await;
            server
        });

        client.initialize().await.unwrap();
        let result = client
            .call_tool("echo", serde_json::json!({}))
            .await;
        let _ = server_task.await.unwrap();
        match result {
            Err(McpClientError::Rpc { code, message }) => {
                assert_eq!(code, -32603);
                assert_eq!(message, "boom");
            }
            other => panic!("expected Rpc error, got {other:?}"),
        }
    }

    // ── HTTP path (using mockito) ─────────────────────────────────────────────

    // 9. http_initialize_posts_to_url_and_parses_body
    #[tokio::test]
    async fn http_initialize_posts_to_url_and_parses_body() {
        use crate::mcp::transport::{HttpTransportFactory, TransportFactory};
        use crate::mcp::types::McpTransportSpec;
        use std::collections::BTreeMap;

        let mut mock_server = mockito::Server::new_async().await;
        // First POST: the initialize request — server returns the result.
        let _m_init = mock_server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"mock","version":"0"}}}"#,
            )
            .expect(1)
            .create_async()
            .await;
        // Second POST: the notifications/initialized message — server may return
        // anything (200 + empty body); the transport discards the response.
        let _m_notif = mock_server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{}"#)
            .expect(1)
            .create_async()
            .await;

        let spec = McpTransportSpec::Http {
            url: mock_server.url() + "/",
            headers: BTreeMap::new(),
        };
        let factory = HttpTransportFactory::new();
        let transport = factory.connect(&spec).await.expect("connect");
        let mut client = McpClient::new(transport);
        client.initialize().await.expect("initialize");
        _m_init.assert_async().await;
        _m_notif.assert_async().await;
    }

    // 10. http_returns_transport_error_on_500_status
    #[tokio::test]
    async fn http_returns_transport_error_on_500_status() {
        use crate::mcp::transport::{HttpTransportFactory, TransportFactory};
        use crate::mcp::types::McpTransportSpec;
        use std::collections::BTreeMap;

        let mut mock_server = mockito::Server::new_async().await;
        let _m = mock_server
            .mock("POST", "/")
            .with_status(500)
            .with_body("Internal Server Error")
            .create_async()
            .await;

        let spec = McpTransportSpec::Http {
            url: mock_server.url() + "/",
            headers: BTreeMap::new(),
        };
        let factory = HttpTransportFactory::new();
        let transport = factory.connect(&spec).await;
        // Either connection fails, or initialize fails — either way with Transport error
        match transport {
            Err(McpClientError::Transport(_)) => {}
            Err(e) => panic!("expected Transport error on 500, got other error: {e}"),
            Ok(t) => {
                let mut client = McpClient::new(t);
                let result = client.initialize().await;
                match result {
                    Err(McpClientError::Transport(_)) => {}
                    Err(e) => panic!("expected Transport error on 500, got other error: {e}"),
                    Ok(()) => panic!("expected Transport error on 500, got Ok"),
                }
            }
        }
    }

    // 11. http_returns_transport_error_on_connection_refused
    #[tokio::test]
    async fn http_returns_transport_error_on_connection_refused() {
        use crate::mcp::transport::{HttpTransportFactory, TransportFactory};
        use crate::mcp::types::McpTransportSpec;
        use std::collections::BTreeMap;

        let spec = McpTransportSpec::Http {
            url: "http://127.0.0.1:1/mcp".to_string(),
            headers: BTreeMap::new(),
        };
        let factory = HttpTransportFactory::new();
        let transport = factory.connect(&spec).await;
        match transport {
            Err(McpClientError::Transport(_)) => {}
            Err(e) => panic!("expected Transport error on conn refused, got other error: {e}"),
            Ok(t) => {
                let mut client = McpClient::new(t);
                let result = client.initialize().await;
                match result {
                    Err(McpClientError::Transport(_)) => {}
                    Err(e) => panic!("expected Transport error on conn refused, got other error: {e}"),
                    Ok(()) => panic!("expected Transport error on conn refused, got Ok"),
                }
            }
        }
    }

    // 12. http_sse_streams_multiple_responses_in_order
    #[tokio::test]
    async fn http_sse_streams_multiple_responses_in_order() {
        use crate::mcp::transport::{HttpTransportFactory, TransportFactory};
        use crate::mcp::types::McpTransportSpec;
        use std::collections::BTreeMap;

        let mut mock_server = mockito::Server::new_async().await;
        let sse_body = concat!(
            "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"serverInfo\":{\"name\":\"sse\",\"version\":\"0\"}}}\n\n",
            "data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[]}}\n\n"
        );
        let _m = mock_server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(sse_body)
            .create_async()
            .await;

        let spec = McpTransportSpec::Http {
            url: mock_server.url() + "/",
            headers: BTreeMap::new(),
        };
        let factory = HttpTransportFactory::new();
        let transport = factory.connect(&spec).await.expect("connect");
        let mut client = McpClient::new(transport);
        client.initialize().await.expect("initialize");
        let tools = client.list_tools().await.expect("list_tools");
        assert_eq!(tools.len(), 0, "expected empty tools array from SSE stream");
    }
}
