use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::agents::builtin_tools::{
    calculator::CalculatorTool,
    clipboard::{ClipboardProvider, ClipboardReadTool, ClipboardWriteTool, SystemClipboard},
    fs::{FsReadTool, FsWriteTool},
    shell::ShellExecTool,
    web_fetch::WebFetchTool,
    web_search::WebSearchTool,
};
use crate::agents::tools::ToolRegistry;
use crate::error::AppError;

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Creates a default `ToolRegistry` with core built-in tools suitable for headless MCP execution.
pub fn create_default_mcp_registry() -> Arc<ToolRegistry> {
    let registry = Arc::new(ToolRegistry::new());
    let _ = registry.register_builtin(Arc::new(CalculatorTool::new()));

    let clipboard_provider: Arc<dyn ClipboardProvider> = Arc::new(SystemClipboard);
    let _ = registry.register_builtin(Arc::new(ClipboardReadTool::new(Arc::clone(
        &clipboard_provider,
    ))));
    let _ = registry.register_builtin(Arc::new(ClipboardWriteTool::new(clipboard_provider)));

    let _ = registry.register_builtin(Arc::new(FsReadTool::new()));
    let _ = registry.register_builtin(Arc::new(FsWriteTool::new()));
    let _ = registry.register_builtin(Arc::new(ShellExecTool::new()));
    let _ = registry.register_builtin(Arc::new(WebFetchTool::new()));
    let _ = registry.register_builtin(Arc::new(WebSearchTool::new()));

    registry
}

/// Finds a built-in tool in the registry with flexible name matching (bare ID, FQID, dashes/underscores).
fn find_builtin_tool(
    registry: &ToolRegistry,
    name: &str,
) -> Option<Arc<dyn crate::agents::tools::BuiltinTool>> {
    if let Some(tool) = registry.get_builtin(name) {
        return Some(tool);
    }

    let stripped = name.strip_prefix("builtin:").unwrap_or(name);
    if let Some(tool) = registry.get_builtin(stripped) {
        return Some(tool);
    }

    let with_dash = stripped.replace('_', "-");
    if let Some(tool) = registry.get_builtin(&with_dash) {
        return Some(tool);
    }

    let with_underscore = stripped.replace('-', "_");
    if let Some(tool) = registry.get_builtin(&with_underscore) {
        return Some(tool);
    }

    None
}

/// Handles a single JSON-RPC line from an MCP client, returning the JSON-RPC response string (if any).
pub async fn handle_mcp_line(line: &str, registry: &ToolRegistry) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let req: JsonRpcRequest = match serde_json::from_str(trimmed) {
        Ok(r) => r,
        Err(e) => {
            let err_resp = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: Value::Null,
                result: None,
                error: Some(JsonRpcError {
                    code: -32700,
                    message: format!("Parse error: {e}"),
                    data: None,
                }),
            };
            return serde_json::to_string(&err_resp).ok();
        }
    };

    // If there is no id, it is a notification.
    let Some(id) = req.id else {
        // Handle notifications (e.g. "notifications/initialized")
        if req.method == "notifications/initialized" {
            log::info!("[asyar mcp] Client initialized notification received");
        }
        return None;
    };

    let response = match req.method.as_str() {
        "initialize" => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "asyar",
                    "version": "0.1.0"
                }
            })),
            error: None,
        },
        "ping" => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(json!({})),
            error: None,
        },
        "tools/list" => {
            let tools: Vec<Value> = registry
                .list_all()
                .into_iter()
                .map(|desc| {
                    json!({
                        "name": desc.id,
                        "description": desc.description,
                        "inputSchema": desc.parameters
                    })
                })
                .collect();

            JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: Some(json!({
                    "tools": tools
                })),
                error: None,
            }
        }
        "tools/call" => {
            let params = req.params.unwrap_or(Value::Null);
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));

            if let Some(tool) = find_builtin_tool(registry, name) {
                match tool.invoke(args).await {
                    Ok(val) => {
                        let text_content = if let Some(s) = val.as_str() {
                            s.to_string()
                        } else {
                            val.to_string()
                        };
                        JsonRpcResponse {
                            jsonrpc: "2.0".to_string(),
                            id,
                            result: Some(json!({
                                "content": [
                                    {
                                        "type": "text",
                                        "text": text_content
                                    }
                                ],
                                "isError": false
                            })),
                            error: None,
                        }
                    }
                    Err(e) => JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id,
                        result: Some(json!({
                            "content": [
                                {
                                    "type": "text",
                                    "text": format!("Error executing tool '{name}': {e}")
                                }
                            ],
                            "isError": true
                        })),
                        error: None,
                    },
                }
            } else {
                JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id,
                    result: Some(json!({
                        "content": [
                            {
                                "type": "text",
                                "text": format!("Tool '{name}' not found")
                            }
                        ],
                        "isError": true
                    })),
                    error: None,
                }
            }
        }
        unknown => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code: -32601,
                message: format!("Method not found: {unknown}"),
                data: None,
            }),
        },
    };

    serde_json::to_string(&response).ok()
}

/// Runs the MCP JSON-RPC server on stdio until stdin reaches EOF.
pub async fn run_stdio_server(registry: Arc<ToolRegistry>) -> Result<(), AppError> {
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut reader = BufReader::new(stdin).lines();

    while let Ok(Some(line)) = reader.next_line().await {
        if let Some(resp) = handle_mcp_line(&line, &registry).await {
            if let Err(e) = stdout.write_all(resp.as_bytes()).await {
                log::error!("[asyar mcp] Failed to write response to stdout: {e}");
                break;
            }
            if let Err(e) = stdout.write_all(b"\n").await {
                log::error!("[asyar mcp] Failed to write newline to stdout: {e}");
                break;
            }
            if let Err(e) = stdout.flush().await {
                log::error!("[asyar mcp] Failed to flush stdout: {e}");
                break;
            }
        }
    }

    Ok(())
}
