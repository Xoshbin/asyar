use crate::agents::tools::ManifestTool;
use crate::error::AppError;
use crate::mcp::types::{McpCallResult, McpClientError, McpToolDescriptor};
use crate::mcp::McpSupervisor;
use crate::storage::mcp_audit::NewMcpAuditEntry;
use crate::storage::DataStore;

/// Returns `true` when the tool name starts with a read-only prefix
/// (e.g. `get_`, `list_`, `search_`).  Write tools return `false` and
/// require an explicit user permission decision before being invoked.
pub fn is_tool_read_only(tool_id: &str) -> bool {
    const READ_PREFIXES: &[&str] = &[
        "get_", "list_", "read_", "search_", "fetch_", "find_",
        "query_", "show_", "describe_", "view_", "inspect_",
    ];
    READ_PREFIXES.iter().any(|p| tool_id.starts_with(p))
}

/// Converts a list of MCP tool descriptors (from the MCP protocol) into the
/// `ManifestTool` shape used by the tool registry. The MCP tool's `name` field
/// becomes both `id` and `name`; `input_schema` becomes `parameters`.
pub fn descriptors_from_mcp_tools(
    _server_id: &str,
    tools: Vec<McpToolDescriptor>,
) -> Vec<ManifestTool> {
    tools
        .into_iter()
        .map(|t| ManifestTool {
            id: t.name.clone(),
            name: t.name,
            description: t.description.unwrap_or_default(),
            parameters: t.input_schema,
        })
        .collect()
}

/// Routes a tool call through the MCP supervisor to the appropriate server.
/// Writes an audit log entry (success or failure) to the data store.
pub async fn invoke_mcp_tool(
    supervisor: &McpSupervisor,
    store: &DataStore,
    server_id: &str,
    tool_id: &str,
    agent_id: Option<&str>,
    args: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    log::debug!(
        "invoke_mcp_tool: server={} tool={} agent={:?}",
        server_id,
        tool_id,
        agent_id
    );

    // Permission gate: write tools always require an explicit user decision.
    // When strict mode is on, every tool — including read-only ones — also
    // requires a decision (defends against misleadingly named tools like
    // `get_and_delete_user`).
    let strict_mode = {
        let conn = store.conn()?;
        crate::storage::mcp_settings::get_strict_mode(&conn).unwrap_or(false)
    };
    if strict_mode || !is_tool_read_only(tool_id) {
        let agent_key = agent_id.unwrap_or("");
        let decision = {
            let conn = store.conn()?;
            crate::storage::mcp_permissions::consume_allow_once(
                &conn, server_id, tool_id, agent_key,
            )?
        };
        match decision {
            Some(crate::storage::mcp_permissions::PermissionDecision::Never) => {
                // Audit the denial before returning.
                let called_at = now_millis();
                let denial_summary = "permission denied".to_string();
                write_audit(
                    store,
                    AuditParams {
                        server_id,
                        tool_id,
                        agent_id,
                        called_at,
                        success: false,
                        error_summary: Some(&denial_summary),
                        args_summary: &args.to_string().chars().take(200).collect::<String>(),
                    },
                );
                return Err(AppError::Validation(format!(
                    "permission denied for {server_id}:{tool_id}"
                )));
            }
            Some(_) => { /* AllowOnce consumed or AllowAlways — proceed */ }
            None => {
                return Err(AppError::McpPermissionRequired {
                    server_id: server_id.to_string(),
                    tool_id: tool_id.to_string(),
                });
            }
        }
    }

    let args_summary: String = args.to_string().chars().take(200).collect();

    let called_at = now_millis();

    let result: Result<McpCallResult, McpClientError> = supervisor
        .call_tool(&server_id.to_string(), tool_id, args)
        .await;

    match result {
        Ok(call_result) => {
            write_audit(
                store,
                AuditParams {
                    server_id,
                    tool_id,
                    agent_id,
                    called_at,
                    success: true,
                    error_summary: None,
                    args_summary: &args_summary,
                },
            );
            Ok(call_result.content)
        }
        Err(e) => {
            let err_summary = format!("{e}");
            write_audit(
                store,
                AuditParams {
                    server_id,
                    tool_id,
                    agent_id,
                    called_at,
                    success: false,
                    error_summary: Some(&err_summary),
                    args_summary: &args_summary,
                },
            );
            Err(map_mcp_error(e, server_id, tool_id))
        }
    }
}

struct AuditParams<'a> {
    server_id: &'a str,
    tool_id: &'a str,
    agent_id: Option<&'a str>,
    called_at: i64,
    success: bool,
    error_summary: Option<&'a str>,
    args_summary: &'a str,
}

fn write_audit(store: &DataStore, p: AuditParams<'_>) {
    let entry = NewMcpAuditEntry {
        server_id: p.server_id.to_string(),
        tool_id: p.tool_id.to_string(),
        agent_id: p.agent_id.map(|s| s.to_string()),
        called_at: p.called_at,
        success: p.success,
        error_summary: p.error_summary.map(|s| s.to_string()),
        args_summary: p.args_summary.to_string(),
    };
    match store.conn() {
        Ok(conn) => {
            if let Err(e) = crate::storage::mcp_audit::insert_entry(&conn, &entry) {
                log::warn!("invoke_mcp_tool: failed to write audit log: {e}");
            }
        }
        Err(e) => {
            log::warn!("invoke_mcp_tool: failed to acquire DB connection for audit: {e}");
        }
    }
}

fn map_mcp_error(err: McpClientError, server_id: &str, tool_id: &str) -> AppError {
    AppError::Other(format!(
        "MCP call failed for server='{}' tool='{}': {}",
        server_id, tool_id, err
    ))
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::transport::{duplex_pair, Transport, TransportFactory};
    use crate::mcp::types::{McpClientError, McpServerConfig, McpTransportSpec};
    use crate::mcp::{McpSupervisor, SupervisorConfig};
    use async_trait::async_trait;
    use std::collections::BTreeMap;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    // ── is_tool_read_only ─────────────────────────────────────────────────────

    #[test]
    fn is_tool_read_only_returns_true_for_read_prefixes() {
        assert!(is_tool_read_only("get_user"), "get_ should be read-only");
        assert!(is_tool_read_only("list_files"), "list_ should be read-only");
        assert!(is_tool_read_only("search_items"), "search_ should be read-only");
        assert!(is_tool_read_only("fetch_data"), "fetch_ should be read-only");
        assert!(is_tool_read_only("find_record"), "find_ should be read-only");
        assert!(is_tool_read_only("query_db"), "query_ should be read-only");
        assert!(is_tool_read_only("show_dashboard"), "show_ should be read-only");
        assert!(is_tool_read_only("describe_schema"), "describe_ should be read-only");
        assert!(is_tool_read_only("view_logs"), "view_ should be read-only");
        assert!(is_tool_read_only("inspect_container"), "inspect_ should be read-only");
        assert!(is_tool_read_only("read_file"), "read_ should be read-only");
    }

    #[test]
    fn is_tool_read_only_returns_false_for_write_prefixes() {
        assert!(!is_tool_read_only("create_user"), "create_ is a write");
        assert!(!is_tool_read_only("update_record"), "update_ is a write");
        assert!(!is_tool_read_only("delete_item"), "delete_ is a write");
        assert!(!is_tool_read_only("run_script"), "run_ is a write");
        assert!(!is_tool_read_only("execute_command"), "execute_ is a write");
        assert!(!is_tool_read_only("write_file"), "write_ is a write");
    }

    #[test]
    fn is_tool_read_only_returns_false_for_empty_string() {
        assert!(!is_tool_read_only(""), "empty string should return false");
    }

    // ── permission gate ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn invoke_mcp_tool_returns_permission_required_for_write_tool_without_decision() {
        let expected_result = serde_json::json!({"ok": true});
        let (factory, _, _) = MockSucceedFactory::new("create_user", expected_result);
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        supervisor.enable(make_config("srv-perm")).await.unwrap();
        wait_connected(&supervisor, "srv-perm").await;

        let store = crate::storage::create_test_store();
        // No permission row set → None decision → McpPermissionRequired
        let result = invoke_mcp_tool(
            &supervisor,
            &store,
            "srv-perm",
            "create_user",
            Some("agent-test"),
            serde_json::json!({"name": "alice"}),
        )
        .await;

        assert!(result.is_err(), "expected Err, got {:?}", result);
        let err = result.unwrap_err();
        let err_str = format!("{:?}", err);
        assert!(
            err_str.contains("McpPermissionRequired") || {
                // check via serialized kind
                let v: serde_json::Value = serde_json::to_value(&err).unwrap();
                v["kind"] == "mcp_permission_required"
            },
            "expected McpPermissionRequired error, got {:?}",
            err
        );
    }

    #[tokio::test]
    async fn invoke_mcp_tool_allows_read_only_tool_without_permission_check() {
        let expected_result = serde_json::json!({"users": []});
        let (factory, _, _) = MockSucceedFactory::new("list_users", expected_result.clone());
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        supervisor.enable(make_config("srv-read")).await.unwrap();
        wait_connected(&supervisor, "srv-read").await;

        let store = crate::storage::create_test_store();
        // No permission row set — list_ is read-only, should succeed without a permission check
        let result = invoke_mcp_tool(
            &supervisor,
            &store,
            "srv-read",
            "list_users",
            Some("agent-test"),
            serde_json::json!({}),
        )
        .await;

        assert!(result.is_ok(), "read-only tool should bypass permission gate, got {:?}", result);
        assert_eq!(result.unwrap(), expected_result);
    }

    #[tokio::test]
    async fn invoke_mcp_tool_consumes_allow_once_decision() {
        use crate::storage::mcp_permissions::{set_permission, get_permission, McpPermissionRow, PermissionDecision};

        let expected_result = serde_json::json!({"created": true});
        let (factory, _, _) = MockSucceedFactory::new("create_user", expected_result.clone());
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        supervisor.enable(make_config("srv-once")).await.unwrap();
        wait_connected(&supervisor, "srv-once").await;

        let store = crate::storage::create_test_store();
        // Set AllowOnce permission
        {
            let conn = store.conn().unwrap();
            set_permission(&conn, &McpPermissionRow {
                server_id: "srv-once".to_string(),
                tool_id: "create_user".to_string(),
                agent_id: "agent-test".to_string(),
                decision: PermissionDecision::AllowOnce,
                set_at: 1000,
            }).unwrap();
        }

        let result = invoke_mcp_tool(
            &supervisor,
            &store,
            "srv-once",
            "create_user",
            Some("agent-test"),
            serde_json::json!({"name": "alice"}),
        )
        .await;

        assert!(result.is_ok(), "AllowOnce should allow the call, got {:?}", result);
        assert_eq!(result.unwrap(), expected_result);

        // Permission row must be deleted after AllowOnce consume
        let conn = store.conn().unwrap();
        let row = get_permission(&conn, "srv-once", "create_user", "agent-test").unwrap();
        assert!(row.is_none(), "AllowOnce row must be deleted after being consumed");
    }

    #[tokio::test]
    async fn invoke_mcp_tool_returns_denied_when_decision_is_never() {
        use crate::storage::mcp_permissions::{set_permission, McpPermissionRow, PermissionDecision};

        let expected_result = serde_json::json!({"created": true});
        let (factory, _, _) = MockSucceedFactory::new("delete_record", expected_result);
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        supervisor.enable(make_config("srv-never")).await.unwrap();
        wait_connected(&supervisor, "srv-never").await;

        let store = crate::storage::create_test_store();
        // Set Never permission
        {
            let conn = store.conn().unwrap();
            set_permission(&conn, &McpPermissionRow {
                server_id: "srv-never".to_string(),
                tool_id: "delete_record".to_string(),
                agent_id: "agent-test".to_string(),
                decision: PermissionDecision::Never,
                set_at: 1000,
            }).unwrap();
        }

        let result = invoke_mcp_tool(
            &supervisor,
            &store,
            "srv-never",
            "delete_record",
            Some("agent-test"),
            serde_json::json!({"id": 1}),
        )
        .await;

        assert!(result.is_err(), "Never decision must return an error");
        let err = result.unwrap_err();
        let err_str = format!("{}", err);
        assert!(
            err_str.contains("permission denied"),
            "error message should mention 'permission denied', got: {err_str}"
        );
    }

    // ── Mock transport factory ────────────────────────────────────────────────

    struct MockSucceedFactory {
        tool_name: String,
        result: serde_json::Value,
        received_tool: Arc<Mutex<Option<String>>>,
        received_args: Arc<Mutex<Option<serde_json::Value>>>,
    }

    impl MockSucceedFactory {
        #[allow(clippy::type_complexity)]
        fn new(
            tool_name: &str,
            result: serde_json::Value,
        ) -> (
            Arc<Self>,
            Arc<Mutex<Option<String>>>,
            Arc<Mutex<Option<serde_json::Value>>>,
        ) {
            let received_tool = Arc::new(Mutex::new(None));
            let received_args = Arc::new(Mutex::new(None));
            let factory = Arc::new(Self {
                tool_name: tool_name.to_string(),
                result,
                received_tool: received_tool.clone(),
                received_args: received_args.clone(),
            });
            (factory, received_tool, received_args)
        }
    }

    #[async_trait]
    impl TransportFactory for MockSucceedFactory {
        async fn connect(
            &self,
            _spec: &McpTransportSpec,
        ) -> Result<Box<dyn Transport>, McpClientError> {
            let (transport, mut server) = duplex_pair();
            let tool_name = self.tool_name.clone();
            let result = self.result.clone();
            let received_tool = self.received_tool.clone();
            let received_args = self.received_args.clone();
            tokio::spawn(async move {
                // Handle initialize
                let _req = server.recv_line().await;
                server
                    .send_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"mock","version":"0"}}}"#)
                    .await;
                let _ = server.recv_line().await; // notifications/initialized

                // Handle list_tools
                let _list = server.recv_line().await;
                let tools_resp = format!(
                    r#"{{"jsonrpc":"2.0","id":2,"result":{{"tools":[{{"name":"{}","description":"test tool","inputSchema":{{"type":"object"}}}}]}}}}"#,
                    tool_name
                );
                server.send_line(&tools_resp).await;

                // Handle call_tool
                loop {
                    let line = server.recv_line().await;
                    match line {
                        None => break,
                        Some(raw) => {
                            let msg: serde_json::Value =
                                serde_json::from_str(&raw).unwrap_or_default();
                            if msg["method"] == "tools/call" {
                                *received_tool.lock().unwrap() =
                                    msg["params"]["name"].as_str().map(|s| s.to_string());
                                *received_args.lock().unwrap() =
                                    msg["params"]["arguments"].clone().into();
                                let call_id = &msg["id"];
                                let resp = format!(
                                    r#"{{"jsonrpc":"2.0","id":{},"result":{{"content":{},"isError":false}}}}"#,
                                    call_id, result
                                );
                                server.send_line(&resp).await;
                            }
                        }
                    }
                }
            });
            Ok(transport)
        }
    }

    struct MockFailFactory;

    #[async_trait]
    impl TransportFactory for MockFailFactory {
        async fn connect(
            &self,
            _spec: &McpTransportSpec,
        ) -> Result<Box<dyn Transport>, McpClientError> {
            Err(McpClientError::Transport("mock: always fails".to_string()))
        }
    }

    fn make_config(id: &str) -> McpServerConfig {
        McpServerConfig {
            id: id.to_string(),
            display_name: format!("Server {id}"),
            transport: McpTransportSpec::Stdio {
                command: "/usr/bin/mcp-server".to_string(),
                args: vec![],
                env: BTreeMap::new(),
                cwd: None,
            },
            enabled: true,
        }
    }

    async fn wait_connected(supervisor: &McpSupervisor, id: &str) {
        use crate::mcp::types::McpServerStatus;
        let deadline = tokio::time::Instant::now() + Duration::from_millis(2000);
        loop {
            if supervisor.status(&id.to_string()).await == Some(McpServerStatus::Connected) {
                return;
            }
            if tokio::time::Instant::now() >= deadline {
                panic!("supervisor did not reach Connected state within 2s");
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    // ── 1. descriptors_from_mcp_tools_maps_input_schema_to_parameters ─────────

    #[test]
    fn descriptors_from_mcp_tools_maps_input_schema_to_parameters() {
        let mcp_tools = vec![McpToolDescriptor {
            name: "search".to_string(),
            description: Some("searches things".to_string()),
            input_schema: serde_json::json!({"type": "object", "properties": {"q": {"type": "string"}}}),
        }];

        let result = descriptors_from_mcp_tools("srv1", mcp_tools);

        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].parameters,
            serde_json::json!({"type": "object", "properties": {"q": {"type": "string"}}})
        );
    }

    // ── 2. descriptors_from_mcp_tools_uses_tool_name_as_id_and_name ───────────

    #[test]
    fn descriptors_from_mcp_tools_uses_tool_name_as_id_and_name() {
        let mcp_tools = vec![McpToolDescriptor {
            name: "my_tool".to_string(),
            description: None,
            input_schema: serde_json::json!({}),
        }];

        let result = descriptors_from_mcp_tools("srv1", mcp_tools);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "my_tool");
        assert_eq!(result[0].name, "my_tool");
    }

    // ── 3. descriptors_from_mcp_tools_handles_optional_description ────────────

    #[test]
    fn descriptors_from_mcp_tools_handles_optional_description() {
        let tools_none = vec![McpToolDescriptor {
            name: "t1".to_string(),
            description: None,
            input_schema: serde_json::json!({}),
        }];
        let tools_some = vec![McpToolDescriptor {
            name: "t2".to_string(),
            description: Some("a description".to_string()),
            input_schema: serde_json::json!({}),
        }];

        let result_none = descriptors_from_mcp_tools("srv1", tools_none);
        let result_some = descriptors_from_mcp_tools("srv1", tools_some);

        assert_eq!(result_none[0].description, "");
        assert_eq!(result_some[0].description, "a description");
    }

    // ── 4. invoke_mcp_tool_calls_supervisor_with_correct_args ─────────────────

    #[tokio::test]
    async fn invoke_mcp_tool_calls_supervisor_with_correct_args() {
        let expected_result = serde_json::json!({"answer": 42});
        // Use a read-only prefix so the permission gate does not block the call.
        let (factory, received_tool, _received_args) =
            MockSucceedFactory::new("get_data", expected_result.clone());
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        supervisor.enable(make_config("srv1")).await.unwrap();
        wait_connected(&supervisor, "srv1").await;

        let store = crate::storage::create_test_store();
        let result = invoke_mcp_tool(
            &supervisor,
            &store,
            "srv1",
            "get_data",
            Some("agent-1"),
            serde_json::json!({"x": 1}),
        )
        .await;

        assert!(result.is_ok(), "invoke_mcp_tool must return Ok, got {:?}", result);
        assert_eq!(result.unwrap(), expected_result);
        assert_eq!(
            received_tool.lock().unwrap().as_deref(),
            Some("get_data"),
            "supervisor must have received the tool call"
        );
    }

    // ── 5. invoke_mcp_tool_returns_supervisor_error_when_call_fails ───────────

    #[tokio::test]
    async fn invoke_mcp_tool_returns_supervisor_error_when_call_fails() {
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            max_crashes_in_window: 3,
            max_backoff: Duration::from_millis(100),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(Arc::new(MockFailFactory), cfg);
        let store = crate::storage::create_test_store();

        // Use a read-only prefix so the permission gate does not interfere.
        let result = invoke_mcp_tool(
            &supervisor,
            &store,
            "srv-missing",
            "get_data",
            None,
            serde_json::json!({}),
        )
        .await;

        assert!(
            result.is_err(),
            "invoke_mcp_tool must return Err when supervisor call fails"
        );
    }

    // ── 6. invoke_mcp_tool_records_anonymous_when_agent_id_is_none ────────────

    #[tokio::test]
    async fn invoke_mcp_tool_records_anonymous_when_agent_id_is_none() {
        let expected_result = serde_json::json!({"ok": true});
        // Use a read-only prefix so the permission gate does not block the call.
        let (factory, _, _) = MockSucceedFactory::new("get_item", expected_result.clone());
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        supervisor.enable(make_config("srv1")).await.unwrap();
        wait_connected(&supervisor, "srv1").await;

        let store = crate::storage::create_test_store();
        let result = invoke_mcp_tool(
            &supervisor,
            &store,
            "srv1",
            "get_item",
            None,
            serde_json::json!({}),
        )
        .await;

        assert!(
            result.is_ok(),
            "invoke_mcp_tool must succeed when agent_id is None, got {:?}",
            result
        );
    }

    // ── 7. invoke_mcp_tool_writes_audit_row_on_success ────────────────────────

    #[tokio::test]
    async fn invoke_mcp_tool_writes_audit_row_on_success() {
        let expected_result = serde_json::json!({"result": "ok"});
        // Use a read-only prefix so the permission gate does not block the call.
        let (factory, _, _) = MockSucceedFactory::new("list_records", expected_result.clone());
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        supervisor.enable(make_config("audit-srv")).await.unwrap();
        wait_connected(&supervisor, "audit-srv").await;

        let store = crate::storage::create_test_store();
        let result = invoke_mcp_tool(
            &supervisor,
            &store,
            "audit-srv",
            "list_records",
            Some("test-agent"),
            serde_json::json!({"key": "val"}),
        )
        .await;

        assert!(result.is_ok(), "expected Ok, got {:?}", result);

        // Check audit row.
        let conn = store.conn().unwrap();
        let rows = crate::storage::mcp_audit::list_recent(&conn, Some("audit-srv"), 10).unwrap();
        assert_eq!(rows.len(), 1, "expected 1 audit row");
        let row = &rows[0];
        assert_eq!(row.server_id, "audit-srv");
        assert_eq!(row.tool_id, "list_records");
        assert_eq!(row.agent_id, Some("test-agent".to_string()));
        assert!(row.success, "expected success=true");
        assert!(
            row.error_summary.is_none(),
            "expected error_summary=None on success"
        );
    }

    // ── 8. invoke_mcp_tool_writes_audit_row_with_error_summary_on_failure ─────

    #[tokio::test]
    async fn invoke_mcp_tool_writes_audit_row_with_error_summary_on_failure() {
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            max_crashes_in_window: 3,
            max_backoff: Duration::from_millis(100),
            ..SupervisorConfig::default()
        };
        // No server registered → call_tool returns NotConnected error.
        // Use a read-only prefix so the permission gate does not block the call.
        let supervisor = McpSupervisor::new(Arc::new(MockFailFactory), cfg);
        let store = crate::storage::create_test_store();

        let result = invoke_mcp_tool(
            &supervisor,
            &store,
            "fail-srv",
            "get_data",
            None,
            serde_json::json!({}),
        )
        .await;

        assert!(result.is_err(), "expected Err, got {:?}", result);

        let conn = store.conn().unwrap();
        let rows = crate::storage::mcp_audit::list_recent(&conn, Some("fail-srv"), 10).unwrap();
        assert_eq!(rows.len(), 1, "expected 1 audit row even on failure");
        let row = &rows[0];
        assert!(!row.success, "expected success=false");
        assert!(
            row.error_summary.is_some(),
            "expected error_summary to be set on failure"
        );
        assert!(
            !row.error_summary.as_deref().unwrap_or("").is_empty(),
            "error_summary must not be empty"
        );
    }
}
