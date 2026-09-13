use crate::ai::types::{
    ChatMessage, ChatParams, ChatStreamEventPayload, CliStatus, ProviderConfig,
};
use crate::error::AppError;
use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;
use tokio_util::codec::{FramedRead, LinesCodec};

/// Resolves the home directory safely without panic.
fn resolve_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Normalizes an engine name or provider identifier (e.g. "google_d5019aba" -> "google", "openai_8f12b" -> "openai").
pub fn normalize_engine(engine: &str) -> &str {
    if engine.starts_with("google") {
        "google"
    } else if engine.starts_with("openai") {
        "openai"
    } else {
        engine
    }
}

/// Resolves candidate paths for a given engine ("google" -> agy, "openai" -> codex).
pub fn cli_candidates(engine: &str) -> Vec<PathBuf> {
    let home = resolve_home_dir();
    let mut candidates = Vec::new();

    match normalize_engine(engine) {
        "google" => {
            if let Some(ref h) = home {
                candidates.push(h.join(".local/bin/agy"));
            }
            candidates.push(PathBuf::from("/opt/homebrew/bin/agy"));
            candidates.push(PathBuf::from("/usr/local/bin/agy"));
        }
        "openai" => {
            candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
            candidates.push(PathBuf::from("/usr/local/bin/codex"));
            if let Some(ref h) = home {
                candidates.push(h.join(".local/bin/codex"));
                candidates.push(h.join(".cargo/bin/codex"));
            }
        }
        _ => {}
    }

    candidates
}

/// Finds the executable for the given engine, checking custom path first, then candidates, then PATH.
pub fn resolve_cli_binary(engine: &str, custom_path: Option<&str>) -> Option<PathBuf> {
    if let Some(custom) = custom_path.filter(|p| !p.trim().is_empty()) {
        let trimmed = custom.trim();
        let expanded = if let Some(stripped) = trimmed.strip_prefix("~/") {
            if let Some(home) = resolve_home_dir() {
                home.join(stripped)
            } else {
                PathBuf::from(trimmed)
            }
        } else {
            PathBuf::from(trimmed)
        };

        if expanded.is_file() {
            return Some(expanded);
        } else {
            return None;
        }
    }

    for candidate in cli_candidates(engine) {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // Fallback: search system PATH via `which <binary>`
    let binary_name = match normalize_engine(engine) {
        "google" => "agy",
        "openai" => "codex",
        other => other,
    };

    if let Ok(output) = std::process::Command::new("which")
        .arg(binary_name)
        .output()
    {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() && Path::new(&path_str).is_file() {
                return Some(PathBuf::from(path_str));
            }
        }
    }

    None
}

/// Checks whether the CLI tool for the given engine is installed and queries its version.
pub async fn check_cli_status(engine: &str, custom_path: Option<&str>) -> CliStatus {
    let resolved = resolve_cli_binary(engine, custom_path);

    let Some(bin_path) = resolved else {
        let name = match normalize_engine(engine) {
            "google" => "Google Antigravity (agy)",
            "openai" => "OpenAI Codex (codex)",
            other => other,
        };
        return CliStatus {
            installed: false,
            path: None,
            version: None,
            error: Some(format!("{name} CLI binary not found on this machine.")),
        };
    };

    let path_str = bin_path.to_string_lossy().to_string();

    // Query version with a short timeout
    let version_cmd = Command::new(&bin_path).arg("--version").output();

    match tokio::time::timeout(std::time::Duration::from_secs(4), version_cmd).await {
        Ok(Ok(output)) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let version = if stdout.is_empty() {
                    String::from_utf8_lossy(&output.stderr).trim().to_string()
                } else {
                    stdout
                };
                CliStatus {
                    installed: true,
                    path: Some(path_str),
                    version: Some(version),
                    error: None,
                }
            } else {
                let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
                CliStatus {
                    installed: true,
                    path: Some(path_str),
                    version: None,
                    error: Some(if err_msg.is_empty() {
                        "CLI exited with non-zero status on version check".to_string()
                    } else {
                        err_msg
                    }),
                }
            }
        }
        Ok(Err(e)) => CliStatus {
            installed: true,
            path: Some(path_str),
            version: None,
            error: Some(format!("Failed to execute CLI binary: {e}")),
        },
        Err(_) => CliStatus {
            installed: true,
            path: Some(path_str),
            version: None,
            error: Some("Timeout querying CLI version".to_string()),
        },
    }
}

/// Builds a structured prompt string from system prompt, chat messages, and user query.
pub fn build_cli_prompt(messages: &[ChatMessage], params: &ChatParams) -> String {
    let mut parts = Vec::new();

    if let Some(sys) = params
        .system_prompt
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        parts.push(format!("[System Instruction]\n{sys}\n"));
    }

    if messages.len() == 1 {
        parts.push(messages[0].content.clone());
    } else {
        for msg in messages {
            let role_label = match msg.role.as_str() {
                "user" => "User",
                "assistant" => "Assistant",
                "system" => "System",
                "tool" => "Tool Output",
                _ => "Message",
            };
            parts.push(format!("{role_label}: {}", msg.content));
        }
    }

    parts.join("\n\n")
}

/// Parses a single line of stdout from a CLI process into stream event payloads.
pub fn parse_cli_stream_line(engine: &str, line: &str) -> Vec<ChatStreamEventPayload> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        // Fallback: non-JSON raw text line
        return vec![ChatStreamEventPayload::Token {
            token: format!("{line}\n"),
        }];
    };

    let mut events = Vec::new();

    // Check error payloads first (support top-level error and agy result.error)
    if let Some(err) = val
        .get("error")
        .or_else(|| val.get("result").and_then(|r| r.get("error")))
        .and_then(|e| e.as_str())
        .filter(|s| !s.is_empty())
    {
        events.push(ChatStreamEventPayload::Error {
            error: err.to_string(),
        });
        return events;
    }

    match normalize_engine(engine) {
        "google" => {
            // Google agy / gemini stream format variations:
            // 1. Google agy step_update: {"event":"step_update","step_update":{"text_delta":"hello"}}
            // 2. Direct token: {"token": "hello"}
            // 3. Direct delta: {"delta": "hello"}
            // 4. Text field: {"text": "hello"}
            // 5. Gemini parts: {"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}
            // 6. OpenAI-like delta choices: {"choices": [{"delta": {"content": "hello"}}]}
            if let Some(delta) = val
                .get("step_update")
                .and_then(|s| s.get("text_delta"))
                .and_then(|t| t.as_str())
            {
                events.push(ChatStreamEventPayload::Token {
                    token: delta.to_string(),
                });
            } else if let Some(token) = val.get("token").and_then(|t| t.as_str()) {
                events.push(ChatStreamEventPayload::Token {
                    token: token.to_string(),
                });
            } else if let Some(delta) = val.get("delta").and_then(|d| d.as_str()) {
                events.push(ChatStreamEventPayload::Token {
                    token: delta.to_string(),
                });
            } else if let Some(text) = val.get("text").and_then(|t| t.as_str()) {
                events.push(ChatStreamEventPayload::Token {
                    token: text.to_string(),
                });
            } else if let Some(candidates) = val.get("candidates").and_then(|c| c.as_array()) {
                for cand in candidates {
                    if let Some(parts) = cand
                        .get("content")
                        .and_then(|c| c.get("parts"))
                        .and_then(|p| p.as_array())
                    {
                        for part in parts {
                            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                                events.push(ChatStreamEventPayload::Token {
                                    token: text.to_string(),
                                });
                            }
                        }
                    }
                }
            } else if let Some(choices) = val.get("choices").and_then(|c| c.as_array()) {
                for choice in choices {
                    if let Some(content) = choice
                        .get("delta")
                        .and_then(|d| d.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        events.push(ChatStreamEventPayload::Token {
                            token: content.to_string(),
                        });
                    }
                }
            }
        }
        "openai" => {
            // Codex exec --json stream format variations:
            // 1. Item delta: {"type": "item.delta", "delta": {"content": "hello"}}
            // 2. Turn event wrapping: {"type": "turn.event", "event": {"type": "item.delta", "delta": {"content": "hello"}}}
            // 3. Simple message chunk: {"type": "message", "content": "hello"}
            // 4. Generic delta/content lookup
            if let Some(content) = val
                .get("delta")
                .and_then(|d| d.get("content"))
                .and_then(|c| c.as_str())
            {
                events.push(ChatStreamEventPayload::Token {
                    token: content.to_string(),
                });
            } else if let Some(content) = val
                .get("event")
                .and_then(|e| e.get("delta"))
                .and_then(|d| d.get("content"))
                .and_then(|c| c.as_str())
            {
                events.push(ChatStreamEventPayload::Token {
                    token: content.to_string(),
                });
            } else if let Some(content) = val.get("content").and_then(|c| c.as_str()) {
                events.push(ChatStreamEventPayload::Token {
                    token: content.to_string(),
                });
            } else if let Some(token) = val.get("token").and_then(|t| t.as_str()) {
                events.push(ChatStreamEventPayload::Token {
                    token: token.to_string(),
                });
            }
        }
        _ => {
            // General token or content extraction
            if let Some(token) = val
                .get("token")
                .or_else(|| val.get("content"))
                .or_else(|| val.get("text"))
                .and_then(|t| t.as_str())
            {
                events.push(ChatStreamEventPayload::Token {
                    token: token.to_string(),
                });
            }
        }
    }

    events
}

/// Helper that registers or updates the "asyar" MCP server entry in the given config JSON file.
pub fn register_mcp_server_in_config(config_file: &Path, current_exe_str: &str) -> bool {
    let mut doc: serde_json::Value = if config_file.is_file() {
        match std::fs::read_to_string(config_file) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({})),
            Err(_) => serde_json::json!({}),
        }
    } else {
        serde_json::json!({})
    };

    if !doc.is_object() {
        doc = serde_json::json!({});
    }

    let mcp_servers = match doc.get_mut("mcpServers") {
        Some(v) if v.is_object() => v,
        _ => {
            doc["mcpServers"] = serde_json::json!({});
            &mut doc["mcpServers"]
        }
    };

    let needs_update = match mcp_servers.get("asyar") {
        Some(asyar_entry) => {
            let cmd = asyar_entry.get("command").and_then(|c| c.as_str());
            let args = asyar_entry.get("args").and_then(|a| a.as_array());
            let has_mcp_arg =
                args.is_some_and(|arr| arr.iter().any(|v| v.as_str() == Some("mcp-server")));
            cmd != Some(current_exe_str) || !has_mcp_arg
        }
        None => true,
    };

    if needs_update {
        if let Some(servers_map) = mcp_servers.as_object_mut() {
            servers_map.insert(
                "asyar".to_string(),
                serde_json::json!({
                    "command": current_exe_str,
                    "args": ["mcp-server"]
                }),
            );

            if let Some(parent) = config_file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(formatted) = serde_json::to_string_pretty(&doc) {
                if std::fs::write(config_file, formatted).is_ok() {
                    log::info!("[asyar mcp] Registered asyar MCP server in {config_file:?}");
                    return true;
                }
            }
        }
    }
    false
}

/// Ensures that Asyar is registered as a local MCP server in Google Antigravity CLI's configuration
/// (~/.gemini/config/mcp_config.json), allowing `agy` to discover and invoke Asyar's tools.
pub fn ensure_mcp_registered_for_agy() {
    let Some(home) = resolve_home_dir() else {
        return;
    };
    let config_file = home.join(".gemini/config/mcp_config.json");

    let Ok(current_exe) = std::env::current_exe() else {
        return;
    };
    let current_exe_str = current_exe.to_string_lossy().to_string();

    register_mcp_server_in_config(&config_file, &current_exe_str);
}

/// Executes a prompt using a local CLI runtime process and streams tokens back to `on_event`.
pub async fn cli_stream_chat_impl<F>(
    provider_id: &str,
    config: ProviderConfig,
    messages: Vec<ChatMessage>,
    params: ChatParams,
    _stream_id: String,
    on_event: F,
) -> Result<(), AppError>
where
    F: Fn(ChatStreamEventPayload) + Send + Sync + 'static,
{
    let engine_type = config.provider_type.as_deref().unwrap_or(provider_id);

    let bin_path =
        resolve_cli_binary(engine_type, config.cli_binary_path.as_deref()).ok_or_else(|| {
            let err_msg = format!("CLI binary for '{engine_type}' could not be found.");
            on_event(ChatStreamEventPayload::Error {
                error: err_msg.clone(),
            });
            AppError::Other(err_msg)
        })?;

    let prompt = build_cli_prompt(&messages, &params);

    let mut cmd = Command::new(&bin_path);

    match normalize_engine(engine_type) {
        "google" => {
            // Ensure Asyar's MCP server is registered with agy so agy can discover Asyar's tools
            ensure_mcp_registered_for_agy();

            // agy -p <prompt> --output-format stream-json --disable-slash-commands --dangerously-skip-permissions
            cmd.arg("-p")
                .arg(&prompt)
                .arg("--output-format")
                .arg("stream-json")
                .arg("--disable-slash-commands")
                .arg("--dangerously-skip-permissions");

            let model = params.model_id.trim();
            // If the model is an obsolete/incompatible API-only model name like "gemini-2.5-flash", "gemini-1.5-flash", etc.,
            // omit --model so agy uses its configured default model instead of crashing with invalid model selection.
            if !model.is_empty()
                && !model.starts_with("gemini-1.")
                && !model.starts_with("gemini-2.")
            {
                cmd.arg("--model").arg(model);
            }

            if let Some(effort) = config.reasoning_effort.as_deref() {
                if matches!(effort, "low" | "medium" | "high")
                    && !model.ends_with("-low")
                    && !model.ends_with("-medium")
                    && !model.ends_with("-high")
                {
                    cmd.arg("--effort").arg(effort);
                }
            }
        }
        "openai" => {
            // codex exec --json --ephemeral [prompt]
            cmd.arg("exec")
                .arg("--json")
                .arg("--ephemeral")
                .arg("--skip-git-repo-check");

            if !params.model_id.trim().is_empty() {
                cmd.arg("-m").arg(&params.model_id);
            }

            cmd.arg(&prompt);
        }
        _ => {
            cmd.arg(&prompt);
        }
    }

    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        let err_msg = format!("Failed to spawn CLI process '{bin_path:?}': {e}");
        on_event(ChatStreamEventPayload::Error {
            error: err_msg.clone(),
        });
        AppError::Other(err_msg)
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("Failed to capture stdout of CLI process".to_string()))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Other("Failed to capture stderr of CLI process".to_string()))?;

    // Drain stderr in background to capture potential diagnostic messages
    let stderr_task = tokio::spawn(async move {
        let mut err_lines = FramedRead::new(tokio::io::BufReader::new(stderr), LinesCodec::new());
        let mut captured = Vec::new();
        while let Some(Ok(line)) = err_lines.next().await {
            log::warn!("[CLI stderr] {line}");
            captured.push(line);
        }
        captured.join("\n")
    });

    let mut out_lines = FramedRead::new(tokio::io::BufReader::new(stdout), LinesCodec::new());

    while let Some(line_res) = out_lines.next().await {
        match line_res {
            Ok(line) => {
                let payloads = parse_cli_stream_line(engine_type, &line);
                for payload in payloads {
                    on_event(payload);
                }
            }
            Err(e) => {
                log::error!("Error reading line from CLI stdout: {e}");
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    let captured_stderr = stderr_task.await.unwrap_or_default();

    if !status.success() {
        let err_msg = if !captured_stderr.trim().is_empty() {
            captured_stderr
        } else {
            format!("CLI process exited with code {}", status)
        };
        on_event(ChatStreamEventPayload::Error {
            error: err_msg.clone(),
        });
        return Err(AppError::Other(err_msg));
    }

    on_event(ChatStreamEventPayload::Done);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_candidates_returns_paths_for_supported_engines() {
        let google_candidates = cli_candidates("google");
        assert!(!google_candidates.is_empty());
        assert!(google_candidates.iter().any(|p| p.ends_with("agy")));

        let openai_candidates = cli_candidates("openai");
        assert!(!openai_candidates.is_empty());
        assert!(openai_candidates.iter().any(|p| p.ends_with("codex")));

        let unknown = cli_candidates("unknown");
        assert!(unknown.is_empty());
    }

    #[test]
    fn test_parse_cli_stream_line_google_ndjson() {
        let line = r#"{"token": "Hello"}"#;
        let events = parse_cli_stream_line("google", line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ChatStreamEventPayload::Token { token } => assert_eq!(token, "Hello"),
            _ => panic!("Expected token event"),
        }

        let delta_line = r#"{"candidates": [{"content": {"parts": [{"text": "world"}]}}]}"#;
        let delta_events = parse_cli_stream_line("google", delta_line);
        assert_eq!(delta_events.len(), 1);
        match &delta_events[0] {
            ChatStreamEventPayload::Token { token } => assert_eq!(token, "world"),
            _ => panic!("Expected token event"),
        }

        let agy_line = r#"{"event":"step_update","step_update":{"conversation_id":"123","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"Hello from agy"}}"#;
        let agy_events = parse_cli_stream_line("google", agy_line);
        assert_eq!(agy_events.len(), 1);
        match &agy_events[0] {
            ChatStreamEventPayload::Token { token } => assert_eq!(token, "Hello from agy"),
            _ => panic!("Expected token event"),
        }
    }

    #[test]
    fn test_parse_cli_stream_line_openai_jsonl() {
        let line = r#"{"type": "item.delta", "delta": {"content": "Greetings"}}"#;
        let events = parse_cli_stream_line("openai", line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ChatStreamEventPayload::Token { token } => assert_eq!(token, "Greetings"),
            _ => panic!("Expected token event"),
        }

        let nested = r#"{"type": "turn.event", "event": {"type": "item.delta", "delta": {"content": " from codex"}}}"#;
        let nested_events = parse_cli_stream_line("openai", nested);
        assert_eq!(nested_events.len(), 1);
        match &nested_events[0] {
            ChatStreamEventPayload::Token { token } => assert_eq!(token, " from codex"),
            _ => panic!("Expected token event"),
        }
    }

    #[test]
    fn test_parse_cli_stream_line_error() {
        let line = r#"{"error": "Quota exceeded"}"#;
        let events = parse_cli_stream_line("google", line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ChatStreamEventPayload::Error { error } => assert_eq!(error, "Quota exceeded"),
            _ => panic!("Expected error event"),
        }
    }

    #[test]
    fn test_build_cli_prompt_formats_system_and_messages() {
        let messages = vec![
            ChatMessage {
                id: "1".to_string(),
                role: "user".to_string(),
                content: "First question".to_string(),
                timestamp: 100,
                tool_calls: None,
                tool_call_id: None,
                provider_context: None,
            },
            ChatMessage {
                id: "2".to_string(),
                role: "assistant".to_string(),
                content: "First answer".to_string(),
                timestamp: 101,
                tool_calls: None,
                tool_call_id: None,
                provider_context: None,
            },
            ChatMessage {
                id: "3".to_string(),
                role: "user".to_string(),
                content: "Second question".to_string(),
                timestamp: 102,
                tool_calls: None,
                tool_call_id: None,
                provider_context: None,
            },
        ];

        let params = ChatParams {
            model_id: "gemini-2.5-flash".to_string(),
            temperature: Some(0.7),
            max_tokens: 2048,
            system_prompt: Some("You are a helpful assistant.".to_string()),
            tools: None,
        };

        let prompt = build_cli_prompt(&messages, &params);
        assert!(prompt.contains("[System Instruction]"));
        assert!(prompt.contains("You are a helpful assistant."));
        assert!(prompt.contains("User: First question"));
        assert!(prompt.contains("Assistant: First answer"));
        assert!(prompt.contains("User: Second question"));
    }

    #[test]
    fn test_register_mcp_server_in_config_creates_and_preserves() {
        let temp_dir =
            std::env::temp_dir().join(format!("asyar_test_mcp_{}", uuid::Uuid::new_v4()));
        let config_file = temp_dir.join("mcp_config.json");

        // Seed with existing server
        let initial = serde_json::json!({
            "mcpServers": {
                "other-server": {
                    "command": "node",
                    "args": ["server.js"]
                }
            }
        });
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(&config_file, initial.to_string()).unwrap();

        // Register asyar
        let updated = register_mcp_server_in_config(&config_file, "/path/to/asyar");
        assert!(updated, "Should update config on first registration");

        // Read back and verify
        let content = std::fs::read_to_string(&config_file).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&content).unwrap();

        assert_eq!(
            doc["mcpServers"]["other-server"]["command"], "node",
            "Existing server must be preserved"
        );
        assert_eq!(doc["mcpServers"]["asyar"]["command"], "/path/to/asyar");
        assert_eq!(
            doc["mcpServers"]["asyar"]["args"],
            serde_json::json!(["mcp-server"])
        );

        // Calling again with same path should not update
        let second_call = register_mcp_server_in_config(&config_file, "/path/to/asyar");
        assert!(
            !second_call,
            "Should not update if already configured identically"
        );

        // Cleanup
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
