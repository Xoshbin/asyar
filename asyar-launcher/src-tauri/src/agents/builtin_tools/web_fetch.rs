use crate::agents::tools::{BuiltinTool, ToolContext, ToolDescriptor, ToolSource};
use crate::error::AppError;
use crate::network::service::{fetch, FetchRequest};
use crate::storage::DataStore;
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;

pub const WEB_READER_REQUEST_TIMEOUT_SECS: u64 = 25;

#[derive(Clone)]
pub enum WebFetchCredentialSource {
    Store {
        data_store: DataStore,
        master_key: [u8; 32],
    },
    None,
}

#[derive(Clone)]
pub struct WebFetchTool {
    credentials: WebFetchCredentialSource,
}

impl WebFetchTool {
    pub fn new() -> Self {
        Self {
            credentials: WebFetchCredentialSource::None,
        }
    }

    pub fn with_store(data_store: DataStore, master_key: [u8; 32]) -> Self {
        Self {
            credentials: WebFetchCredentialSource::Store {
                data_store,
                master_key,
            },
        }
    }

    pub fn without_credentials() -> Self {
        Self::new()
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

    async fn invoke_with_context(
        &self,
        args: serde_json::Value,
        context: &ToolContext,
    ) -> Result<serde_json::Value, AppError> {
        let req = parse_fetch_args(args)?;

        let is_get_without_body = req
            .method
            .as_deref()
            .unwrap_or("GET")
            .eq_ignore_ascii_case("GET")
            && req.body.is_none();

        if !is_get_without_body {
            return fetch(req).await;
        }

        let Some(web_reader_cfg) = &context.web_reader else {
            return fetch(req).await;
        };

        let Some(reader) = &web_reader_cfg.reader else {
            return fetch(req).await;
        };

        let Some(rest) = reader.strip_prefix("ext:") else {
            return fetch(req).await;
        };

        let Some((extension_id, reader_id)) = rest.split_once(':') else {
            return fetch(req).await;
        };

        let Some(dispatcher) = &context.external_dispatcher else {
            log::warn!(
                "No external dispatcher available for extension web reader '{reader}'; falling back to native HTTP fetch"
            );
            return fetch(req).await;
        };

        // Try to resolve API key from store if configured
        let api_key = match &self.credentials {
            WebFetchCredentialSource::Store {
                data_store,
                master_key,
            } => {
                let conn = data_store.conn();
                if let Ok(conn) = conn {
                    let cred_id = format!("web_reader:{reader}");
                    crate::storage::ai_credentials::get(&conn, &cred_id, master_key)
                        .ok()
                        .flatten()
                } else {
                    None
                }
            }
            WebFetchCredentialSource::None => None,
        };

        let request = crate::agents::runner::ExternalToolRequest {
            tool_call_id: format!("wr-{}", uuid::Uuid::new_v4()),
            tool_id: format!("webreader:{extension_id}:{reader_id}"),
            arguments: json!({
                "url": req.url,
                "apiKey": api_key.as_deref(),
                "baseUrl": web_reader_cfg.base_url.as_deref(),
            }),
        };

        let dispatch_future = dispatcher(request);
        match tokio::time::timeout(
            Duration::from_secs(WEB_READER_REQUEST_TIMEOUT_SECS),
            dispatch_future,
        )
        .await
        {
            Ok(Ok(response_value)) => {
                let status = response_value
                    .get("status")
                    .and_then(|s| s.as_u64())
                    .unwrap_or(200) as u16;
                let content = response_value
                    .get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                let ok = (200..300).contains(&status);
                let mut resp_obj = json!({
                    "status": status,
                    "statusText": if ok { "OK" } else { "Error" },
                    "headers": {},
                    "body": content,
                    "ok": ok,
                });
                if let Some(title) = response_value.get("title").and_then(|t| t.as_str()) {
                    resp_obj["title"] = serde_json::Value::String(title.to_string());
                }
                if let Some(url) = response_value.get("url").and_then(|u| u.as_str()) {
                    resp_obj["url"] = serde_json::Value::String(url.to_string());
                }
                Ok(resp_obj)
            }
            Ok(Err(e)) => {
                log::warn!(
                    "Extension web reader '{reader}' failed ({e}); falling back to native HTTP fetch"
                );
                fetch(req).await
            }
            Err(_) => {
                log::warn!(
                    "Extension web reader '{reader}' timed out after {WEB_READER_REQUEST_TIMEOUT_SECS}s; falling back to native HTTP fetch"
                );
                fetch(req).await
            }
        }
    }
}
