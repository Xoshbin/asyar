use std::collections::BTreeMap;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type McpServerId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpServerConfig {
    pub id: McpServerId,
    pub display_name: String,
    pub transport: McpTransportSpec,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum McpTransportSpec {
    Stdio {
        command: String,
        args: Vec<String>,
        env: BTreeMap<String, String>,
        cwd: Option<String>,
    },
    Http {
        url: String,
        headers: BTreeMap<String, String>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpServerStatus {
    Starting,
    Connected,
    Failed,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpToolDescriptor {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpCallResult {
    pub content: serde_json::Value,
    pub is_error: bool,
}

#[derive(Debug, Error)]
pub enum McpClientError {
    #[error("transport error: {0}")]
    Transport(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("rpc error {code}: {message}")]
    Rpc { code: i64, message: String },
    #[error("server exited before completing handshake")]
    EarlyExit,
    #[error("timeout waiting for response to id={0}")]
    Timeout(u64),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    // 1. transport_spec_stdio_serde_round_trip
    #[test]
    fn transport_spec_stdio_serde_round_trip() {
        let spec = McpTransportSpec::Stdio {
            command: "/usr/bin/my-mcp".to_string(),
            args: vec!["--mode".to_string(), "stdio".to_string()],
            env: {
                let mut m = BTreeMap::new();
                m.insert("KEY".to_string(), "VALUE".to_string());
                m
            },
            cwd: Some("/tmp".to_string()),
        };
        let json = serde_json::to_string(&spec).expect("serialize");
        let back: McpTransportSpec = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(spec, back);
    }

    // 2. transport_spec_http_serde_round_trip
    #[test]
    fn transport_spec_http_serde_round_trip() {
        let spec = McpTransportSpec::Http {
            url: "http://localhost:8080/mcp".to_string(),
            headers: {
                let mut m = BTreeMap::new();
                m.insert("Authorization".to_string(), "Bearer tok".to_string());
                m
            },
        };
        let json = serde_json::to_string(&spec).expect("serialize");
        let back: McpTransportSpec = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(spec, back);
    }

    // 3. server_status_serializes_snake_case
    #[test]
    fn server_status_serializes_snake_case() {
        let s = McpServerStatus::Connected;
        let json = serde_json::to_string(&s).expect("serialize");
        assert_eq!(json, "\"connected\"");
    }

    // 4. tool_descriptor_round_trip_preserves_input_schema
    #[test]
    fn tool_descriptor_round_trip_preserves_input_schema() {
        let descriptor = McpToolDescriptor {
            name: "my_tool".to_string(),
            description: Some("does stuff".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "x": { "type": "string" },
                    "nested": { "foo": { "bar": 42 } }
                }
            }),
        };
        let json = serde_json::to_string(&descriptor).expect("serialize");
        let back: McpToolDescriptor = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(descriptor, back);
    }

    // 5. mcp_client_error_rpc_display_includes_code_and_message
    #[test]
    fn mcp_client_error_rpc_display_includes_code_and_message() {
        let err = McpClientError::Rpc {
            code: -32601,
            message: "x".to_string(),
        };
        let display = format!("{}", err);
        assert!(display.contains("-32601"), "display must contain the code: {display}");
        assert!(display.contains("x"), "display must contain the message: {display}");
    }

    // 6. server_config_default_enabled_field_round_trips
    #[test]
    fn server_config_default_enabled_field_round_trips() {
        let config = McpServerConfig {
            id: "srv1".to_string(),
            display_name: "Server One".to_string(),
            transport: McpTransportSpec::Http {
                url: "http://localhost:9000".to_string(),
                headers: BTreeMap::new(),
            },
            enabled: false,
        };
        let json = serde_json::to_string(&config).expect("serialize");
        let back: McpServerConfig = serde_json::from_str(&json).expect("deserialize");
        assert!(!back.enabled);
        assert_eq!(config, back);
    }
}
