use super::server::{create_default_mcp_registry, handle_mcp_line};
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
