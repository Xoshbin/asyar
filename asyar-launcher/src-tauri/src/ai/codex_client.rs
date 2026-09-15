use crate::ai::types::{ChatStreamEventPayload, CliAccountInfo, ModelInfo};
use crate::error::AppError;
use futures_util::StreamExt;
use std::path::Path;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, Command};
use tokio_util::codec::{FramedRead, LinesCodec};

/// Spawns `codex app-server --stdio` as a managed tokio child process.
async fn spawn_codex_app_server(
    binary_path: &Path,
) -> Result<
    (
        Child,
        ChildStdin,
        FramedRead<tokio::io::BufReader<tokio::process::ChildStdout>, LinesCodec>,
    ),
    AppError,
> {
    let mut cmd = Command::new(binary_path);
    cmd.arg("app-server")
        .arg("--stdio")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        AppError::Other(format!(
            "Failed to spawn codex app-server '{binary_path:?}': {e}"
        ))
    })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Other("Failed to capture stdin for codex app-server".into()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("Failed to capture stdout for codex app-server".into()))?;

    let lines = FramedRead::new(tokio::io::BufReader::new(stdout), LinesCodec::new());

    Ok((child, stdin, lines))
}

/// Helper that sends a JSON-RPC message over child stdin.
async fn send_json_rpc(stdin: &mut ChildStdin, value: &serde_json::Value) -> Result<(), AppError> {
    let line = serde_json::to_string(value)
        .map_err(|e| AppError::Other(format!("JSON-RPC serialization error: {e}")))?;
    stdin
        .write_all(format!("{line}\n").as_bytes())
        .await
        .map_err(|e| AppError::Other(format!("Failed to write to codex app-server stdin: {e}")))?;
    stdin
        .flush()
        .await
        .map_err(|e| AppError::Other(format!("Failed to flush codex app-server stdin: {e}")))?;
    Ok(())
}

/// Performs the initial protocol handshake (`initialize` request followed by `initialized` notification).
async fn perform_handshake(
    stdin: &mut ChildStdin,
    lines: &mut FramedRead<tokio::io::BufReader<tokio::process::ChildStdout>, LinesCodec>,
) -> Result<(), AppError> {
    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "clientInfo": {
                "name": "asyar",
                "title": "Asyar Launcher",
                "version": env!("CARGO_PKG_VERSION")
            },
            "capabilities": {}
        }
    });

    send_json_rpc(stdin, &init_req).await?;

    // Wait for response to id: 1
    while let Some(line_res) = lines.next().await {
        let line = line_res.map_err(|e| AppError::Other(format!("Read error: {e}")))?;
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            if val.get("id").and_then(|id| id.as_i64()) == Some(1) {
                break;
            }
        }
    }

    let initialized_notif = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    });

    send_json_rpc(stdin, &initialized_notif).await?;
    Ok(())
}

pub struct CodexClient;

impl CodexClient {
    /// Connects to `codex app-server --stdio`, performs handshake, and queries account and rate-limit details.
    pub async fn probe_account(binary_path: &Path) -> Result<CliAccountInfo, AppError> {
        let (mut child, mut stdin, mut lines) = spawn_codex_app_server(binary_path).await?;

        let probe_fut = async {
            perform_handshake(&mut stdin, &mut lines).await?;

            // Send account/read (id: 2)
            let acc_req = serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "account/read",
                "params": {}
            });
            send_json_rpc(&mut stdin, &acc_req).await?;

            // Send account/rateLimits/read (id: 3)
            let limits_req = serde_json::json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "account/rateLimits/read",
                "params": {}
            });
            send_json_rpc(&mut stdin, &limits_req).await?;

            let mut email: Option<String> = None;
            let mut plan_type: Option<String> = None;
            let mut quota_used_percent: Option<u32> = None;
            let mut quota_resets_at: Option<i64> = None;

            let mut got_acc = false;
            let mut got_limits = false;

            while let Some(line_res) = lines.next().await {
                let line = line_res.map_err(|e| AppError::Other(format!("Read error: {e}")))?;
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    let id = val.get("id").and_then(|id| id.as_i64());

                    if id == Some(2) {
                        got_acc = true;
                        if let Some(res) = val.get("result") {
                            if let Some(acc) = res.get("account") {
                                email = acc.get("email").and_then(|e| e.as_str()).map(String::from);
                                plan_type = acc
                                    .get("planType")
                                    .and_then(|p| p.as_str())
                                    .map(String::from);
                            }
                        }
                    } else if id == Some(3) {
                        got_limits = true;
                        if let Some(res) = val.get("result") {
                            if let Some(rate_limits) = res.get("rateLimits") {
                                if plan_type.is_none() {
                                    plan_type = rate_limits
                                        .get("planType")
                                        .and_then(|p| p.as_str())
                                        .map(String::from);
                                }
                                if let Some(primary) = rate_limits.get("primary") {
                                    quota_used_percent = primary
                                        .get("usedPercent")
                                        .and_then(|u| u.as_u64())
                                        .map(|u| u as u32);
                                    quota_resets_at =
                                        primary.get("resetsAt").and_then(|r| r.as_i64());
                                }
                            }
                        }
                    }

                    if got_acc && got_limits {
                        break;
                    }
                }
            }

            Ok(CliAccountInfo {
                email,
                plan_type,
                quota_used_percent,
                quota_resets_at,
            })
        };

        let result = tokio::time::timeout(std::time::Duration::from_secs(6), probe_fut).await;
        let _ = child.kill().await;

        match result {
            Ok(r) => r,
            Err(_) => Err(AppError::Other(
                "Timeout probing account details from codex app-server".into(),
            )),
        }
    }

    /// Queries models from `codex app-server --stdio` via the `model/list` RPC method.
    pub async fn list_models(binary_path: &Path) -> Result<Vec<ModelInfo>, AppError> {
        let (mut child, mut stdin, mut lines) = spawn_codex_app_server(binary_path).await?;

        let list_fut = async {
            perform_handshake(&mut stdin, &mut lines).await?;

            let model_req = serde_json::json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "model/list",
                "params": {}
            });
            send_json_rpc(&mut stdin, &model_req).await?;

            let mut models = Vec::new();

            while let Some(line_res) = lines.next().await {
                let line = line_res.map_err(|e| AppError::Other(format!("Read error: {e}")))?;
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    if val.get("id").and_then(|id| id.as_i64()) == Some(4) {
                        if let Some(items) = val
                            .get("result")
                            .and_then(|r| r.get("data"))
                            .and_then(|d| d.as_array())
                        {
                            for item in items {
                                let id = item.get("id").and_then(|i| i.as_str()).unwrap_or("");
                                if id.is_empty() {
                                    continue;
                                }
                                let label = item
                                    .get("displayName")
                                    .or_else(|| item.get("model"))
                                    .and_then(|m| m.as_str())
                                    .unwrap_or(id);

                                let reasoning_efforts = item
                                    .get("supportedReasoningEfforts")
                                    .and_then(|r| r.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|e| {
                                                e.get("reasoningEffort")
                                                    .and_then(|s| s.as_str())
                                                    .map(String::from)
                                            })
                                            .collect::<Vec<String>>()
                                    })
                                    .filter(|efforts| !efforts.is_empty());

                                models.push(ModelInfo {
                                    id: id.to_string(),
                                    label: label.to_string(),
                                    reasoning_efforts,
                                });
                            }
                        }
                        break;
                    }
                }
            }

            Ok(models)
        };

        let result = tokio::time::timeout(std::time::Duration::from_secs(6), list_fut).await;
        let _ = child.kill().await;

        match result {
            Ok(r) => r,
            Err(_) => Err(AppError::Other(
                "Timeout listing models from codex app-server".into(),
            )),
        }
    }

    /// Runs a full turn through `codex app-server --stdio` with `thread/start` and `turn/start`,
    /// streaming delta tokens to `on_event`.
    pub async fn stream_turn<F>(
        binary_path: &Path,
        prompt: &str,
        model_id: Option<&str>,
        _reasoning_effort: Option<&str>,
        on_event: F,
    ) -> Result<(), AppError>
    where
        F: Fn(ChatStreamEventPayload) + Send + Sync + 'static,
    {
        let (mut child, mut stdin, mut lines) = spawn_codex_app_server(binary_path).await?;

        perform_handshake(&mut stdin, &mut lines).await?;

        // 1. thread/start (id: 2)
        let mut thread_params = serde_json::Map::new();
        if let Some(m) = model_id.filter(|s| !s.trim().is_empty()) {
            thread_params.insert("model".into(), serde_json::Value::String(m.to_string()));
        }

        let thread_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "thread/start",
            "params": thread_params
        });
        send_json_rpc(&mut stdin, &thread_req).await?;

        let mut thread_id: Option<String> = None;
        while let Some(line_res) = lines.next().await {
            let line = line_res.map_err(|e| AppError::Other(format!("Read error: {e}")))?;
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                if val.get("id").and_then(|id| id.as_i64()) == Some(2) {
                    if let Some(tid) = val
                        .get("result")
                        .and_then(|r| r.get("thread"))
                        .and_then(|t| t.get("id"))
                        .and_then(|i| i.as_str())
                    {
                        thread_id = Some(tid.to_string());
                    }
                    break;
                }
            }
        }

        let Some(tid) = thread_id else {
            let err = "Failed to obtain thread ID from codex app-server".to_string();
            on_event(ChatStreamEventPayload::Error { error: err.clone() });
            let _ = child.kill().await;
            return Err(AppError::Other(err));
        };

        // 2. turn/start (id: 3)
        let turn_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "turn/start",
            "params": {
                "threadId": tid,
                "input": [
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        });
        send_json_rpc(&mut stdin, &turn_req).await?;

        // 3. Process incoming stream notifications
        while let Some(line_res) = lines.next().await {
            let line = match line_res {
                Ok(l) => l,
                Err(e) => {
                    let err = format!("Stream read error: {e}");
                    on_event(ChatStreamEventPayload::Error { error: err.clone() });
                    let _ = child.kill().await;
                    return Err(AppError::Other(err));
                }
            };

            let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };

            // Check server notifications
            if let Some(method) = val.get("method").and_then(|m| m.as_str()) {
                match method {
                    "item/agentMessage/delta" => {
                        if let Some(delta) = val
                            .get("params")
                            .and_then(|p| p.get("delta"))
                            .and_then(|d| d.as_str())
                        {
                            on_event(ChatStreamEventPayload::Token {
                                token: delta.to_string(),
                            });
                        }
                    }
                    "item/reasoning/textDelta" => {
                        if let Some(delta) = val
                            .get("params")
                            .and_then(|p| p.get("delta"))
                            .and_then(|d| d.as_str())
                        {
                            on_event(ChatStreamEventPayload::Token {
                                token: delta.to_string(),
                            });
                        }
                    }
                    "turn/completed" => {
                        on_event(ChatStreamEventPayload::Done);
                        let _ = child.kill().await;
                        return Ok(());
                    }
                    "error" => {
                        let err_msg = val
                            .get("params")
                            .and_then(|p| p.get("message"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("Unknown error from codex app-server");
                        on_event(ChatStreamEventPayload::Error {
                            error: err_msg.to_string(),
                        });
                        let _ = child.kill().await;
                        return Err(AppError::Other(err_msg.to_string()));
                    }
                    _ => {}
                }
            }

            // Check turn/start response failure
            if val.get("id").and_then(|id| id.as_i64()) == Some(3) {
                if let Some(err) = val.get("error") {
                    let err_msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("Failed to start turn in codex app-server");
                    on_event(ChatStreamEventPayload::Error {
                        error: err_msg.to_string(),
                    });
                    let _ = child.kill().await;
                    return Err(AppError::Other(err_msg.to_string()));
                }
            }
        }

        on_event(ChatStreamEventPayload::Done);
        let _ = child.kill().await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_account_and_limits_json() {
        let acc_json = serde_json::json!({
            "id": 2,
            "result": {
                "account": {
                    "type": "chatgpt",
                    "email": "test@example.com",
                    "planType": "pro"
                },
                "requiresOpenaiAuth": true
            }
        });

        let limits_json = serde_json::json!({
            "id": 3,
            "result": {
                "rateLimits": {
                    "limitId": "codex",
                    "primary": {
                        "usedPercent": 15,
                        "windowDurationMins": 43200,
                        "resetsAt": 1791902182
                    },
                    "planType": "pro"
                }
            }
        });

        let mut email = None;
        let mut plan_type = None;
        let mut quota_used = None;
        let mut quota_resets = None;

        if let Some(res) = acc_json.get("result") {
            if let Some(acc) = res.get("account") {
                email = acc.get("email").and_then(|e| e.as_str()).map(String::from);
                plan_type = acc
                    .get("planType")
                    .and_then(|p| p.as_str())
                    .map(String::from);
            }
        }

        if let Some(res) = limits_json.get("result") {
            if let Some(rate_limits) = res.get("rateLimits") {
                if let Some(primary) = rate_limits.get("primary") {
                    quota_used = primary
                        .get("usedPercent")
                        .and_then(|u| u.as_u64())
                        .map(|u| u as u32);
                    quota_resets = primary.get("resetsAt").and_then(|r| r.as_i64());
                }
            }
        }

        assert_eq!(email, Some("test@example.com".to_string()));
        assert_eq!(plan_type, Some("pro".to_string()));
        assert_eq!(quota_used, Some(15));
        assert_eq!(quota_resets, Some(1791902182));
    }

    #[test]
    fn test_parse_model_list_json() {
        let models_json = serde_json::json!({
            "id": 4,
            "result": {
                "data": [
                    {
                        "id": "gpt-5.6-terra",
                        "displayName": "GPT-5.6-Terra",
                        "supportedReasoningEfforts": [
                            { "reasoningEffort": "low" },
                            { "reasoningEffort": "medium" },
                            { "reasoningEffort": "high" }
                        ]
                    }
                ]
            }
        });

        let mut models = Vec::new();
        if let Some(items) = models_json
            .get("result")
            .and_then(|r| r.get("data"))
            .and_then(|d| d.as_array())
        {
            for item in items {
                let id = item.get("id").and_then(|i| i.as_str()).unwrap_or("");
                let label = item
                    .get("displayName")
                    .and_then(|m| m.as_str())
                    .unwrap_or(id);
                let reasoning_efforts = item
                    .get("supportedReasoningEfforts")
                    .and_then(|r| r.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|e| {
                                e.get("reasoningEffort")
                                    .and_then(|s| s.as_str())
                                    .map(String::from)
                            })
                            .collect::<Vec<String>>()
                    });
                models.push(ModelInfo {
                    id: id.to_string(),
                    label: label.to_string(),
                    reasoning_efforts,
                });
            }
        }

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-5.6-terra");
        assert_eq!(models[0].label, "GPT-5.6-Terra");
        assert_eq!(
            models[0].reasoning_efforts,
            Some(vec!["low".into(), "medium".into(), "high".into()])
        );
    }
}
