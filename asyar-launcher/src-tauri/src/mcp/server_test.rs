use super::server::{
    create_default_mcp_registry, create_mcp_registry, handle_mcp_line, parse_mcp_allow_flag,
};
use serde_json::{json, Value};

#[tokio::test]
async fn test_mcp_initialize() {
    let registry = create_default_mcp_registry();
    let line = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "test-client",
                "version": "1.0.0"
            }
        }
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    assert_eq!(resp["jsonrpc"], "2.0");
    assert_eq!(resp["id"], 1);
    assert_eq!(resp["result"]["protocolVersion"], "2024-11-05");
    assert_eq!(resp["result"]["serverInfo"]["name"], "asyar");
    assert!(resp["result"]["capabilities"]["tools"].is_object());
}

#[tokio::test]
async fn test_mcp_ping() {
    let registry = create_default_mcp_registry();
    let line = json!({
        "jsonrpc": "2.0",
        "id": 42,
        "method": "ping"
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    assert_eq!(resp["id"], 42);
    assert_eq!(resp["result"], json!({}));
}

#[tokio::test]
async fn test_mcp_notification_returns_none() {
    let registry = create_default_mcp_registry();
    let line = json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry).await;
    assert!(resp_str.is_none());
}

#[tokio::test]
async fn test_mcp_tools_list() {
    let registry = create_default_mcp_registry();
    let line = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list"
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    assert_eq!(resp["id"], 2);
    let tools = resp["result"]["tools"].as_array().expect("tools array");
    let has_calculator = tools.iter().any(|t| t["name"] == "calculator");
    let has_fs_read = tools.iter().any(|t| t["name"] == "fs-read");
    let has_clipboard_read = tools.iter().any(|t| t["name"] == "clipboard-read");

    assert!(has_calculator, "tools/list should include calculator");
    assert!(has_fs_read, "tools/list should include fs-read");
    assert!(
        has_clipboard_read,
        "tools/list should include clipboard-read"
    );
}

#[tokio::test]
async fn test_mcp_tools_call_calculator() {
    let registry = create_default_mcp_registry();
    let line = json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "calculator",
            "arguments": {
                "expression": "15 * 8"
            }
        }
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    assert_eq!(resp["id"], 3);
    assert_eq!(resp["result"]["isError"], false);
    let content = resp["result"]["content"].as_array().unwrap();
    assert_eq!(content[0]["text"], "120");
}

#[tokio::test]
async fn test_mcp_tools_call_unknown_tool() {
    let registry = create_default_mcp_registry();
    let line = json!({
        "jsonrpc": "2.0",
        "id": 4,
        "method": "tools/call",
        "params": {
            "name": "non_existent_tool",
            "arguments": {}
        }
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    assert_eq!(resp["id"], 4);
    assert_eq!(resp["result"]["isError"], true);
    assert!(resp["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("not found"));
}

#[tokio::test]
async fn test_mcp_unknown_method_error() {
    let registry = create_default_mcp_registry();
    let line = json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "unknown/method"
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    assert_eq!(resp["id"], 5);
    assert_eq!(resp["error"]["code"], -32601);
}

#[tokio::test]
async fn test_mcp_bare_start_has_empty_tools_list() {
    let registry = create_mcp_registry([] as [&str; 0]);
    let line = json!({
        "jsonrpc": "2.0",
        "id": 10,
        "method": "tools/list"
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    assert_eq!(resp["id"], 10);
    let tools = resp["result"]["tools"].as_array().expect("tools array");
    assert!(
        tools.is_empty(),
        "bare start with no allowed tools must expose zero tools"
    );
}

#[tokio::test]
async fn test_mcp_allow_calculator_registers_only_calculator() {
    let registry = create_mcp_registry(["calculator"]);
    let line = json!({
        "jsonrpc": "2.0",
        "id": 11,
        "method": "tools/list"
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    let tools = resp["result"]["tools"].as_array().expect("tools array");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["name"], "calculator");
}

#[tokio::test]
async fn test_mcp_tools_call_unregistered_tool_returns_not_found() {
    let registry = create_mcp_registry(["calculator"]);
    let line = json!({
        "jsonrpc": "2.0",
        "id": 12,
        "method": "tools/call",
        "params": {
            "name": "fs-read",
            "arguments": { "path": "/tmp/test" }
        }
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    assert_eq!(resp["id"], 12);
    assert_eq!(resp["result"]["isError"], true);
    assert!(resp["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("not found"));
}

#[tokio::test]
async fn test_mcp_unknown_allow_id_is_ignored() {
    let registry = create_mcp_registry(["nonexistent-tool", "calculator"]);
    let line = json!({
        "jsonrpc": "2.0",
        "id": 13,
        "method": "tools/list"
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    let tools = resp["result"]["tools"].as_array().expect("tools array");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["name"], "calculator");
}

#[test]
fn test_parse_mcp_allow_flag() {
    assert_eq!(
        parse_mcp_allow_flag(&["asyar".into(), "mcp-server".into()]),
        None
    );
    assert_eq!(
        parse_mcp_allow_flag(&[
            "asyar".into(),
            "mcp-server".into(),
            "--allow".into(),
            "calculator".into()
        ]),
        Some(vec!["calculator".to_string()])
    );
    assert_eq!(
        parse_mcp_allow_flag(&[
            "asyar".into(),
            "mcp-server".into(),
            "--allow".into(),
            "calculator,web-search".into()
        ]),
        Some(vec!["calculator".to_string(), "web-search".to_string()])
    );
    assert_eq!(
        parse_mcp_allow_flag(&[
            "asyar".into(),
            "mcp-server".into(),
            "--allow=calculator,fs-read".into()
        ]),
        Some(vec!["calculator".to_string(), "fs-read".to_string()])
    );
    assert_eq!(
        parse_mcp_allow_flag(&["asyar".into(), "mcp-server".into(), "--allow".into()]),
        Some(vec![])
    );
}

#[tokio::test]
async fn test_mcp_web_search_strips_model_config() {
    let registry = std::sync::Arc::new(crate::agents::tools::ToolRegistry::new());

    struct InspectTool(std::sync::Arc<std::sync::Mutex<Option<Value>>>);
    #[async_trait::async_trait]
    impl crate::agents::tools::BuiltinTool for InspectTool {
        fn descriptor(&self) -> crate::agents::tools::ToolDescriptor {
            crate::agents::tools::ToolDescriptor {
                id: "web-search".to_string(),
                name: "Web Search".to_string(),
                description: "mock web search".to_string(),
                parameters: json!({}),
                source: crate::agents::tools::ToolSource::Builtin,
                fully_qualified_id: "builtin:web-search".to_string(),
            }
        }
        async fn invoke(&self, args: Value) -> Result<Value, crate::error::AppError> {
            *self.0.lock().unwrap() = Some(args);
            Ok(json!({ "sources": [], "results": [] }))
        }
    }

    let captured = std::sync::Arc::new(std::sync::Mutex::new(None));
    registry
        .register_builtin(std::sync::Arc::new(InspectTool(captured.clone())))
        .unwrap();

    let line = json!({
        "jsonrpc": "2.0",
        "id": 88,
        "method": "tools/call",
        "params": {
            "name": "web-search",
            "arguments": {
                "query": "rust",
                "limit": 5,
                "__config": {
                    "engine": "brave"
                }
            }
        }
    })
    .to_string();

    let resp_str = handle_mcp_line(&line, &registry)
        .await
        .expect("response expected");
    let resp: Value = serde_json::from_str(&resp_str).unwrap();

    assert_eq!(resp["id"], 88);
    assert_eq!(resp["result"]["isError"], false);

    let received_args = captured.lock().unwrap().take().expect("tool was invoked");
    assert_eq!(received_args["query"], "rust");
    assert_eq!(received_args["limit"], 5);
    assert!(
        received_args.get("__config").is_none(),
        "__config must be stripped before invoking tool"
    );
}
