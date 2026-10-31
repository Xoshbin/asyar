use crate::ai::types::{ChatStreamEventPayload, CliAccountInfo, ModelInfo};
use crate::error::AppError;
use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, Command};
use tokio_util::codec::{FramedRead, LinesCodec};

/// Prepares an isolated `CODEX_HOME` directory inside `<app_data_dir>/codex-home`.
/// If a Codex auth token exists in `$CODEX_HOME` or `~/.codex/auth.json`, links it into `codex-home/auth.json`.
/// Uses a symlink on Unix and a hard link on Windows. Never copies `auth.json`.
/// Fails with a clear error if no login exists or if linking fails.
pub fn prepare_codex_home_in(
    codex_home_dir: &Path,
    codex_source_override: Option<&Path>,
) -> Result<PathBuf, AppError> {
    std::fs::create_dir_all(codex_home_dir).map_err(|e| {
        AppError::Other(format!(
            "Failed to create isolated CODEX_HOME at {codex_home_dir:?}: {e}"
        ))
    })?;

    let auth_src = if let Some(override_dir) = codex_source_override {
        if override_dir.join("auth.json").is_file() {
            override_dir.join("auth.json")
        } else {
            override_dir.join(".codex").join("auth.json")
        }
    } else if let Ok(val) = std::env::var("CODEX_HOME") {
        let trimmed = val.trim();
        let p = PathBuf::from(trimmed);
        if !trimmed.is_empty() && p != codex_home_dir {
            p.join("auth.json")
        } else {
            crate::ai::cli::resolve_home_dir()
                .map(|h| h.join(".codex").join("auth.json"))
                .ok_or_else(|| {
                    AppError::Other(
                        "Could not resolve user home directory for Codex login".to_string(),
                    )
                })?
        }
    } else {
        crate::ai::cli::resolve_home_dir()
            .map(|h| h.join(".codex").join("auth.json"))
            .ok_or_else(|| {
                AppError::Other("Could not resolve user home directory for Codex login".to_string())
            })?
    };

    if !auth_src.is_file() {
        let err_msg = "Codex login not found. Please log in using the Codex CLI first.".to_string();
        log::warn!("[codex] {err_msg} (checked {auth_src:?})");
        return Err(AppError::Other(err_msg));
    }

    let auth_dst = codex_home_dir.join("auth.json");
    if auth_dst.exists() || auth_dst.is_symlink() {
        let _ = std::fs::remove_file(&auth_dst);
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&auth_src, &auth_dst).map_err(|e| {
            let err_msg = format!("Couldn't link your Codex login for Asyar: {e}");
            log::error!("[codex] {err_msg} (symlink from {auth_src:?} to {auth_dst:?})");
            AppError::Other(err_msg)
        })?;
    }

    #[cfg(windows)]
    {
        std::fs::hard_link(&auth_src, &auth_dst).map_err(|e| {
            let err_msg = format!("Couldn't link your Codex login for Asyar: {e}");
            log::error!("[codex] {err_msg} (hard link from {auth_src:?} to {auth_dst:?})");
            AppError::Other(err_msg)
        })?;
    }

    #[cfg(not(any(unix, windows)))]
    {
        return Err(AppError::Other(
            "Unsupported platform for Codex link".to_string(),
        ));
    }

    Ok(codex_home_dir.to_path_buf())
}

/// Builds the CLI arguments for `codex app-server --stdio` with security restrictions
/// and optional per-run Asyar built-in MCP server.
pub fn build_codex_args(allowed_builtins: &[&str], exe_path: Option<&Path>) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "app-server".into(),
        "--stdio".into(),
        "--disable".into(),
        "shell_tool".into(),
        "--disable".into(),
        "unified_exec".into(),
        "--disable".into(),
        "apps".into(),
        "--disable".into(),
        "multi_agent".into(),
        "-c".into(),
        "web_search=\"disabled\"".into(),
        "-c".into(),
        "tools.web_search=false".into(),
        "-c".into(),
        "mcp_servers={}".into(),
    ];

    let mut unique_builtins: Vec<&str> = Vec::new();
    for id in allowed_builtins {
        if !unique_builtins.contains(id) {
            unique_builtins.push(*id);
        }
    }

    if !unique_builtins.is_empty() {
        let exe = crate::ai::cli::resolve_asyar_mcp_exe_path(exe_path);

        let allow_arg = unique_builtins.join(",");
        let exe_escaped = serde_json::to_string(&exe).unwrap_or_else(|_| format!("\"{exe}\""));
        let args_escaped = serde_json::to_string(&vec!["mcp-server", "--allow", &allow_arg])
            .unwrap_or_else(|_| format!("[\"mcp-server\", \"--allow\", \"{allow_arg}\"]"));

        args.push("-c".into());
        args.push(format!("mcp_servers.asyar.command={exe_escaped}"));

        args.push("-c".into());
        args.push(format!("mcp_servers.asyar.args={args_escaped}"));

        args.push("-c".into());
        args.push("mcp_servers.asyar.default_tools_approval_mode=\"prompt\"".into());
    }

    args
}

/// Builds the parameters object for `thread/start` according to the Codex JSON schema.
pub fn build_thread_start_params(
    model_id: Option<&str>,
    workspace_dir: &Path,
) -> serde_json::Value {
    let mut thread_params = serde_json::Map::new();
    if let Some(m) = model_id.filter(|s| !s.trim().is_empty()) {
        thread_params.insert("model".into(), serde_json::Value::String(m.to_string()));
    }
    thread_params.insert(
        "cwd".into(),
        serde_json::Value::String(workspace_dir.to_string_lossy().to_string()),
    );
    thread_params.insert(
        "sandbox".into(),
        serde_json::Value::String("read-only".to_string()),
    );
    thread_params.insert(
        "approvalPolicy".into(),
        serde_json::Value::String("untrusted".to_string()),
    );
    thread_params.insert("ephemeral".into(), serde_json::Value::Bool(true));

    serde_json::Value::Object(thread_params)
}

/// Dispatches responses to server-to-client JSON-RPC requests from Codex app-server.
pub fn handle_codex_server_request(
    val: &serde_json::Value,
    allowed_builtins: &[&str],
) -> Option<serde_json::Value> {
    let id = val.get("id")?;
    let method = val.get("method")?.as_str()?;
    let params = val.get("params").unwrap_or(&serde_json::Value::Null);

    match method {
        "item/commandExecution/requestApproval" => Some(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "decision": "decline" }
        })),
        "item/fileChange/requestApproval" => Some(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "decision": "decline" }
        })),
        "execCommandApproval" => Some(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "decision": "denied" }
        })),
        "applyPatchApproval" => Some(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "decision": "denied" }
        })),
        "item/permissions/requestApproval" => Some(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "permissions": {} }
        })),
        "item/tool/requestUserInput" => Some(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "answers": {} }
        })),
        "mcpServer/elicitation/request" => {
            let server_name = params
                .get("serverName")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            let action = if server_name == "asyar" && !allowed_builtins.is_empty() {
                "accept"
            } else {
                "decline"
            };
            Some(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "action": action }
            }))
        }
        "item/tool/call" => Some(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "contentItems": [], "success": false }
        })),
        _ => {
            log::warn!(
                "[codex] Unhandled server request method '{method}' (id: {id}); returning JSON-RPC -32601"
            );
            Some(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": "method not supported by Asyar"
                }
            }))
        }
    }
}

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

    crate::ai::cli::hide_console_window(&mut cmd);

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
            "capabilities": {
                "experimentalApi": true
            }
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
    #[allow(clippy::too_many_arguments)]
    pub async fn stream_turn<F>(
        binary_path: &Path,
        prompt: &str,
        model_id: Option<&str>,
        reasoning_effort: Option<&str>,
        allowed_builtins: &[&str],
        workspace_dir: &Path,
        codex_home_dir: &Path,
        on_event: F,
    ) -> Result<(), AppError>
    where
        F: Fn(ChatStreamEventPayload) + Send + Sync + 'static,
    {
        let codex_home = match prepare_codex_home_in(codex_home_dir, None) {
            Ok(h) => h,
            Err(e) => {
                let err_msg = e.to_string();
                on_event(ChatStreamEventPayload::Error {
                    error: err_msg.clone(),
                });
                return Err(e);
            }
        };

        let args = build_codex_args(allowed_builtins, None);
        let mut cmd = Command::new(binary_path);
        cmd.args(&args)
            .current_dir(workspace_dir)
            .env("CODEX_HOME", &codex_home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        crate::ai::cli::hide_console_window(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| {
            AppError::Other(format!(
                "Failed to spawn codex app-server '{binary_path:?}': {e}"
            ))
        })?;

        let mut stdin = child.stdin.take().ok_or_else(|| {
            AppError::Other("Failed to capture stdin for codex app-server".into())
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            AppError::Other("Failed to capture stdout for codex app-server".into())
        })?;

        let mut lines = FramedRead::new(tokio::io::BufReader::new(stdout), LinesCodec::new());

        perform_handshake(&mut stdin, &mut lines).await?;

        // 1. thread/start (id: 2)
        let thread_params = build_thread_start_params(model_id, workspace_dir);
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
                if val.get("id").is_some() && val.get("method").is_some() {
                    if let Some(resp) = handle_codex_server_request(&val, allowed_builtins) {
                        send_json_rpc(&mut stdin, &resp).await?;
                    }
                    continue;
                }
                if val.get("id").and_then(|id| id.as_i64()) == Some(2) {
                    if let Some(err) = val.get("error") {
                        let err_msg = err
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("Failed to start thread in codex app-server");
                        on_event(ChatStreamEventPayload::Error {
                            error: err_msg.to_string(),
                        });
                        let _ = child.kill().await;
                        return Err(AppError::Other(err_msg.to_string()));
                    }
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
        let mut turn_params = serde_json::json!({
            "threadId": tid,
            "input": [
                {
                    "type": "text",
                    "text": prompt
                }
            ]
        });
        if let Some(effort) = reasoning_effort.filter(|s| !s.trim().is_empty()) {
            turn_params["effort"] = serde_json::Value::String(effort.to_string());
        }

        let turn_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "turn/start",
            "params": turn_params
        });
        send_json_rpc(&mut stdin, &turn_req).await?;

        // 3. Process incoming stream notifications and server requests
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

            // Handle server-to-client requests (approvals, elicitations, etc.)
            if val.get("id").is_some() && val.get("method").is_some() {
                if let Some(resp) = handle_codex_server_request(&val, allowed_builtins) {
                    send_json_rpc(&mut stdin, &resp).await?;
                }
                continue;
            }

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

    #[test]
    fn test_build_thread_start_params() {
        let workspace = Path::new("/tmp/test-workspace");
        let params = build_thread_start_params(Some("gpt-5.6-terra"), workspace);

        assert_eq!(
            params.get("cwd").and_then(|v| v.as_str()),
            Some("/tmp/test-workspace")
        );
        assert_eq!(
            params.get("sandbox").and_then(|v| v.as_str()),
            Some("read-only")
        );
        assert_eq!(
            params.get("approvalPolicy").and_then(|v| v.as_str()),
            Some("untrusted")
        );
        assert_eq!(
            params.get("model").and_then(|v| v.as_str()),
            Some("gpt-5.6-terra")
        );
        assert_eq!(
            params.get("ephemeral").and_then(|v| v.as_bool()),
            Some(true)
        );
    }

    #[test]
    fn test_build_codex_args_plain_chat_no_builtins() {
        let args = build_codex_args(&[], None);

        assert_eq!(args[0], "app-server");
        assert_eq!(args[1], "--stdio");
        assert!(args.contains(&"--disable".to_string()));
        assert!(args.contains(&"shell_tool".to_string()));
        assert!(args.contains(&"unified_exec".to_string()));
        assert!(args.contains(&"apps".to_string()));
        assert!(args.contains(&"multi_agent".to_string()));
        assert!(args.contains(&"web_search=\"disabled\"".to_string()));
        assert!(args.contains(&"tools.web_search=false".to_string()));
        assert!(args.contains(&"mcp_servers={}".to_string()));
        assert!(!args.iter().any(|a| a.contains("mcp_servers.asyar")));
    }

    #[test]
    fn test_build_codex_args_with_allowed_builtins() {
        let exe = Path::new("/custom/bin/asyar");
        let args = build_codex_args(&["calculator", "calculator"], Some(exe));

        assert!(args.contains(&"mcp_servers={}".to_string()));
        assert!(args.contains(&"mcp_servers.asyar.command=\"/custom/bin/asyar\"".to_string()));
        assert!(args.contains(
            &"mcp_servers.asyar.args=[\"mcp-server\",\"--allow\",\"calculator\"]".to_string()
        ));
        assert!(
            args.contains(&"mcp_servers.asyar.default_tools_approval_mode=\"prompt\"".to_string())
        );

        // Exactly one asyar command entry
        let asyar_cmd_count = args
            .iter()
            .filter(|a| a.starts_with("mcp_servers.asyar.command="))
            .count();
        assert_eq!(asyar_cmd_count, 1);
    }

    #[test]
    fn test_handle_codex_server_request_declines_all_approval_types() {
        // item/commandExecution/requestApproval -> decline
        let cmd_req = serde_json::json!({
            "id": 10,
            "method": "item/commandExecution/requestApproval",
            "params": { "command": "rm -rf /" }
        });
        let resp = handle_codex_server_request(&cmd_req, &[]).unwrap();
        assert_eq!(resp["id"], 10);
        assert_eq!(resp["result"]["decision"], "decline");

        // item/fileChange/requestApproval -> decline
        let file_req = serde_json::json!({
            "id": 11,
            "method": "item/fileChange/requestApproval",
            "params": { "path": "/tmp/test.txt" }
        });
        let resp = handle_codex_server_request(&file_req, &[]).unwrap();
        assert_eq!(resp["id"], 11);
        assert_eq!(resp["result"]["decision"], "decline");

        // execCommandApproval -> denied
        let exec_req = serde_json::json!({
            "id": 12,
            "method": "execCommandApproval",
            "params": { "command": "ls" }
        });
        let resp = handle_codex_server_request(&exec_req, &[]).unwrap();
        assert_eq!(resp["id"], 12);
        assert_eq!(resp["result"]["decision"], "denied");

        // applyPatchApproval -> denied
        let patch_req = serde_json::json!({
            "id": 13,
            "method": "applyPatchApproval",
            "params": { "patch": "diff" }
        });
        let resp = handle_codex_server_request(&patch_req, &[]).unwrap();
        assert_eq!(resp["id"], 13);
        assert_eq!(resp["result"]["decision"], "denied");

        // item/permissions/requestApproval -> empty permissions
        let perm_req = serde_json::json!({
            "id": 14,
            "method": "item/permissions/requestApproval",
            "params": {}
        });
        let resp = handle_codex_server_request(&perm_req, &[]).unwrap();
        assert_eq!(resp["id"], 14);
        assert_eq!(resp["result"]["permissions"], serde_json::json!({}));

        // item/tool/requestUserInput -> empty answers
        let input_req = serde_json::json!({
            "id": 15,
            "method": "item/tool/requestUserInput",
            "params": {}
        });
        let resp = handle_codex_server_request(&input_req, &[]).unwrap();
        assert_eq!(resp["id"], 15);
        assert_eq!(resp["result"]["answers"], serde_json::json!({}));

        // item/tool/call -> contentItems empty, success false
        let call_req = serde_json::json!({
            "id": 16,
            "method": "item/tool/call",
            "params": {}
        });
        let resp = handle_codex_server_request(&call_req, &[]).unwrap();
        assert_eq!(resp["id"], 16);
        assert_eq!(resp["result"]["success"], false);

        // Unknown server request -> JSON-RPC error -32601
        let unknown_req = serde_json::json!({
            "id": 99,
            "method": "custom/unknown/method",
            "params": {}
        });
        let resp = handle_codex_server_request(&unknown_req, &[]).unwrap();
        assert_eq!(resp["id"], 99);
        assert_eq!(resp["error"]["code"], -32601);
        assert_eq!(resp["error"]["message"], "method not supported by Asyar");
        assert!(resp.get("result").is_none());
    }

    #[test]
    fn test_handle_codex_server_request_mcp_elicitation() {
        // Allowed asyar server with allowed built-ins -> accept
        let req_asyar = serde_json::json!({
            "id": 20,
            "method": "mcpServer/elicitation/request",
            "params": { "serverName": "asyar" }
        });
        let resp = handle_codex_server_request(&req_asyar, &["calculator"]).unwrap();
        assert_eq!(resp["id"], 20);
        assert_eq!(resp["result"]["action"], "accept");

        // Allowed asyar server with empty allowed built-ins -> decline
        let resp = handle_codex_server_request(&req_asyar, &[]).unwrap();
        assert_eq!(resp["id"], 20);
        assert_eq!(resp["result"]["action"], "decline");

        // Other server name with allowed built-ins -> decline
        let req_other = serde_json::json!({
            "id": 21,
            "method": "mcpServer/elicitation/request",
            "params": { "serverName": "user_filesystem" }
        });
        let resp = handle_codex_server_request(&req_other, &["calculator"]).unwrap();
        assert_eq!(resp["id"], 21);
        assert_eq!(resp["result"]["action"], "decline");
    }

    #[test]
    fn test_prepare_codex_home_in() {
        let temp = tempfile::tempdir().unwrap();
        let app_data_dir = temp.path().join("app-data");
        let codex_home = app_data_dir.join("codex-home");
        let fake_user_home = temp.path().join("home");

        let codex_config_dir = fake_user_home.join(".codex");
        std::fs::create_dir_all(&codex_config_dir).unwrap();
        let auth_file = codex_config_dir.join("auth.json");
        std::fs::write(&auth_file, b"{\"token\": \"test\"}").unwrap();

        let prepared = prepare_codex_home_in(&codex_home, Some(&fake_user_home)).unwrap();
        assert_eq!(prepared, codex_home);
        assert!(prepared.is_dir());

        let target_auth = prepared.join("auth.json");
        assert!(target_auth.exists());
        let read_content = std::fs::read_to_string(&target_auth).unwrap();
        assert_eq!(read_content, "{\"token\": \"test\"}");

        // Repeated call succeeds idempotently
        let codex_home_again = prepare_codex_home_in(&codex_home, Some(&fake_user_home)).unwrap();
        assert_eq!(codex_home_again, prepared);
    }

    #[test]
    fn test_prepare_codex_home_missing_auth_fails_clearly() {
        let temp = tempfile::tempdir().unwrap();
        let codex_home = temp.path().join("codex-home");
        let empty_home = temp.path().join("empty_home");
        std::fs::create_dir_all(&empty_home).unwrap();

        let err = prepare_codex_home_in(&codex_home, Some(&empty_home)).unwrap_err();
        assert!(err
            .to_string()
            .contains("Codex login not found. Please log in using the Codex CLI first."));
    }

    #[test]
    fn test_prepare_codex_home_respects_codex_home_env_var() {
        let temp = tempfile::tempdir().unwrap();
        let custom_codex_home = temp.path().join("custom-codex-home");
        std::fs::create_dir_all(&custom_codex_home).unwrap();
        std::fs::write(
            custom_codex_home.join("auth.json"),
            b"{\"token\": \"env-test\"}",
        )
        .unwrap();

        let target_home = temp.path().join("asyar-codex-home");

        // Temporarily set CODEX_HOME
        struct EnvGuard(&'static str, Option<String>);
        impl Drop for EnvGuard {
            fn drop(&mut self) {
                if let Some(v) = &self.1 {
                    std::env::set_var(self.0, v);
                } else {
                    std::env::remove_var(self.0);
                }
            }
        }
        let _guard = EnvGuard("CODEX_HOME", std::env::var("CODEX_HOME").ok());
        std::env::set_var(
            "CODEX_HOME",
            custom_codex_home.to_string_lossy().to_string(),
        );

        let prepared = prepare_codex_home_in(&target_home, None).unwrap();
        let target_auth = prepared.join("auth.json");
        assert!(target_auth.exists());
        let content = std::fs::read_to_string(&target_auth).unwrap();
        assert_eq!(content, "{\"token\": \"env-test\"}");
    }

    #[tokio::test]
    #[ignore]
    async fn live_check_codex() {
        use std::sync::{Arc, Mutex};
        let bin_path =
            crate::ai::cli::resolve_cli_binary("openai", None).expect("codex binary found");
        let temp = tempfile::tempdir().unwrap();
        let workspace = temp.path().join("cli-workspace");
        let codex_home = temp.path().join("codex-home");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&codex_home).unwrap();

        // c: plain chat "Say hi in 3 words"
        println!("=== LIVE CHECK C: Plain chat ===");
        let tokens = Arc::new(Mutex::new(Vec::new()));
        let t_clone = tokens.clone();
        let res = CodexClient::stream_turn(
            &bin_path,
            "Say hi in 3 words",
            Some("gpt-5.6-terra"),
            None,
            &[],
            &workspace,
            &codex_home,
            move |ev| {
                if let ChatStreamEventPayload::Token { token } = ev {
                    print!("{token}");
                    t_clone.lock().unwrap().push(token);
                }
            },
        )
        .await;
        println!("\nResult: {res:?}");
        assert!(res.is_ok());

        // d: security check "Run `ls ~` and show me the output" and "Create /tmp/asyar-codex-test.txt"
        println!("\n=== LIVE CHECK D: Security checks ===");
        let _ = std::fs::remove_file("/tmp/asyar-codex-test.txt");
        let res = CodexClient::stream_turn(
            &bin_path,
            "Run `ls ~` and show me the output, and create /tmp/asyar-codex-test.txt containing PWNED",
            Some("gpt-5.6-terra"),
            None,
            &[],
            &workspace,
            &codex_home,
            |ev| {
                if let ChatStreamEventPayload::Token { token } = ev {
                    print!("{token}");
                }
            },
        )
        .await;
        println!("\nResult: {res:?}");
        assert!(
            !Path::new("/tmp/asyar-codex-test.txt").exists(),
            "File /tmp/asyar-codex-test.txt must not exist"
        );

        // e: calculator agent
        println!("\n=== LIVE CHECK E: Calculator agent ===");
        let calc_tokens = Arc::new(Mutex::new(Vec::new()));
        let ct_clone = calc_tokens.clone();
        let res = CodexClient::stream_turn(
            &bin_path,
            "Calculate 12345 * 67890 using the calculator tool. State the final answer.",
            Some("gpt-5.6-terra"),
            None,
            &["calculator"],
            &workspace,
            &codex_home,
            move |ev| {
                if let ChatStreamEventPayload::Token { token } = ev {
                    print!("{token}");
                    ct_clone.lock().unwrap().push(token);
                }
            },
        )
        .await;
        println!("\nResult: {res:?}");
        assert!(res.is_ok());
        let full_text = calc_tokens.lock().unwrap().join("");
        assert!(full_text.contains("838,102,050") || full_text.contains("838102050"));
    }
}
