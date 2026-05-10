use crate::agents::tools::{BuiltinTool, ToolDescriptor, ToolSource};
use crate::error::AppError;
use crate::network::service::{fetch, FetchRequest};
use serde_json::json;
use std::collections::HashMap;

pub struct WebFetchTool;

impl WebFetchTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WebFetchTool {
    fn default() -> Self {
        Self::new()
    }
}

/// Parses a `serde_json::Value` argument object into a [`FetchRequest`].
///
/// Validates each optional field's type and converts `headers` from a
/// JSON object of string values to a `HashMap<String, String>`.
pub(crate) fn parse_fetch_args(args: serde_json::Value) -> Result<FetchRequest, AppError> {
    // Required: url (string).
    let url = args
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Validation("missing required 'url' string argument".into()))?
        .to_string();

    // Optional: method (string or null).
    let method = match args.get("method") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        _ => return Err(AppError::Validation("'method' must be a string".into())),
    };

    // Optional: headers (object of string→string, or null).
    let headers: Option<HashMap<String, String>> = match args.get("headers") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::Object(map)) => {
            let mut out = HashMap::with_capacity(map.len());
            for (k, v) in map {
                let s = v.as_str().ok_or_else(|| {
                    AppError::Validation(format!("header '{}' must have a string value", k))
                })?;
                out.insert(k.clone(), s.to_string());
            }
            Some(out)
        }
        _ => return Err(AppError::Validation("'headers' must be an object".into())),
    };

    // Optional: body (string or null).
    let body = match args.get("body") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        _ => return Err(AppError::Validation("'body' must be a string".into())),
    };

    // Optional: timeoutMs (number or null).
    let timeout_ms = match args.get("timeoutMs") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::Number(n)) => n.as_u64(),
        _ => return Err(AppError::Validation("'timeoutMs' must be a number".into())),
    };

    Ok(FetchRequest {
        url,
        method,
        headers,
        body,
        timeout_ms,
    })
}

#[async_trait::async_trait]
impl BuiltinTool for WebFetchTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "web-fetch".into(),
            name: "Fetch URL".into(),
            description: "Perform an HTTP request and return the response.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "url":       { "type": "string", "description": "Absolute http(s) URL." },
                    "method":    { "type": "string", "description": "HTTP method (default GET)." },
                    "headers":   { "type": "object", "description": "String-string headers." },
                    "body":      { "type": "string", "description": "Request body." },
                    "timeoutMs": { "type": "number", "description": "Timeout in milliseconds." }
                },
                "required": ["url"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:web-fetch".into(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let req = parse_fetch_args(args)?;
        fetch(req).await
    }
}
