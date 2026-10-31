use crate::ai::types::{
    ChatMessage, ChatParams, ChatStreamEventPayload, CliAccountInfo, CliStatus, ProviderConfig,
};
use crate::error::AppError;
use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;
use tokio_util::codec::{FramedRead, LinesCodec};

/// Keep console-subsystem CLI children (and `.cmd` shims run via cmd.exe)
/// from opening a visible console window when spawned from the GUI process.
pub(crate) fn hide_console_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Resolves the home directory safely without panic.
pub(crate) fn resolve_home_dir() -> Option<PathBuf> {
    // `HOME` is unset on Windows by default; fall back to the platform home dir (USERPROFILE).
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
}

/// Normalizes an engine name or provider identifier (e.g. "google_d5019aba" -> "google", "openai_8f12b" -> "openai", "anthropic_123" -> "claude").
pub fn normalize_engine(engine: &str) -> &str {
    if engine.starts_with("google") {
        "google"
    } else if engine.starts_with("openai") {
        "openai"
    } else if engine.starts_with("anthropic") || engine.starts_with("claude") {
        "claude"
    } else {
        engine
    }
}

/// Resolves candidate paths for a given engine ("google" -> agy, "openai" -> codex, "claude" -> claude).
pub fn cli_candidates(engine: &str) -> Vec<PathBuf> {
    let home = resolve_home_dir();
    let mut candidates = Vec::new();

    match normalize_engine(engine) {
        "google" => {
            if let Some(ref h) = home {
                candidates.push(h.join(".local/bin/agy"));
                #[cfg(windows)]
                {
                    candidates.push(h.join(".local/bin/agy.exe"));
                    candidates.push(h.join("AppData/Local/Programs/agy/agy.exe"));
                }
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
                #[cfg(windows)]
                {
                    candidates.push(h.join(".local/bin/codex.exe"));
                    candidates.push(h.join(".cargo/bin/codex.exe"));
                    candidates.push(h.join("AppData/Roaming/npm/codex.cmd"));
                }
            }
        }
        "claude" => {
            if let Some(ref h) = home {
                candidates.push(h.join(".local/bin/claude"));
                candidates.push(h.join(".npm-global/bin/claude"));
                #[cfg(windows)]
                {
                    candidates.push(h.join(".local/bin/claude.exe"));
                    candidates.push(h.join("AppData/Roaming/npm/claude.cmd"));
                }
            }
            candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
            candidates.push(PathBuf::from("/usr/local/bin/claude"));
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

    // Fallback: search system PATH via `which <binary>` on Unix or `where <binary>` on Windows
    let binary_name = match normalize_engine(engine) {
        "google" => "agy",
        "openai" => "codex",
        "claude" => "claude",
        other => other,
    };

    let which_cmd = if cfg!(windows) { "where" } else { "which" };

    let mut which = std::process::Command::new(which_cmd);
    which.arg(binary_name);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        which.creation_flags(CREATE_NO_WINDOW);
    }
    if let Ok(output) = which.output() {
        if output.status.success() {
            let stdout_str = String::from_utf8_lossy(&output.stdout);
            for line in stdout_str.lines() {
                let path_str = line.trim();
                if !path_str.is_empty() && Path::new(path_str).is_file() {
                    return Some(PathBuf::from(path_str));
                }
            }
        }
    }

    None
}

/// Checks whether the CLI tool for the given engine is installed and queries its version.
pub async fn check_cli_status(engine: &str, custom_path: Option<&str>) -> CliStatus {
    check_cli_status_in(engine, custom_path, resolve_home_dir().as_deref()).await
}

/// Parameterized status check that accepts an optional home directory override,
/// ensuring status probes and tests can run in isolated environments without touching real files.
pub async fn check_cli_status_in(
    engine: &str,
    custom_path: Option<&str>,
    home: Option<&Path>,
) -> CliStatus {
    let resolved = resolve_cli_binary(engine, custom_path);

    let Some(bin_path) = resolved else {
        let name = match normalize_engine(engine) {
            "google" => "Google Antigravity (agy)",
            "openai" => "OpenAI Codex (codex)",
            "claude" => "Claude Code (claude)",
            other => other,
        };
        return CliStatus {
            installed: false,
            path: None,
            version: None,
            error: Some(format!("{name} CLI binary not found on this machine.")),
            account: None,
        };
    };

    let path_str = bin_path.to_string_lossy().to_string();

    // If OpenAI, probe account & rate limits via codex app-server.
    // If Google, probe active account from ~/.gemini.
    // If Claude, probe active account from ~/.claude.json.
    let account = if normalize_engine(engine) == "openai" {
        crate::ai::codex_client::CodexClient::probe_account(&bin_path)
            .await
            .ok()
    } else if normalize_engine(engine) == "google" {
        home.and_then(probe_agy_account_in)
    } else if normalize_engine(engine) == "claude" {
        home.and_then(probe_claude_account_in)
    } else {
        None
    };

    // Query version with a short timeout
    let mut version_cmd = Command::new(&bin_path);
    version_cmd.arg("--version");
    hide_console_window(&mut version_cmd);
    let version_cmd = version_cmd.output();

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
                    account,
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
                    account,
                }
            }
        }
        Ok(Err(e)) => CliStatus {
            installed: true,
            path: Some(path_str),
            version: None,
            error: Some(format!("Failed to execute CLI binary: {e}")),
            account: None,
        },
        Err(_) => CliStatus {
            installed: true,
            path: Some(path_str),
            version: None,
            error: Some("Timeout querying CLI version".to_string()),
            account: None,
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

/// Per-run parser state for engines whose stream repeats content (Claude Code emits
/// text deltas and then the same text again in the completed `assistant` message).
#[derive(Debug, Default)]
pub struct CliStreamState {
    claude_message_streamed: bool,
}

/// Parses a single line of stdout from a CLI process into stream event payloads.
pub fn parse_cli_stream_line(engine: &str, line: &str) -> Vec<ChatStreamEventPayload> {
    parse_cli_stream_line_stateful(engine, line, &mut CliStreamState::default())
}

/// Like [`parse_cli_stream_line`], but carries `state` across the lines of one run.
pub fn parse_cli_stream_line_stateful(
    engine: &str,
    line: &str,
    state: &mut CliStreamState,
) -> Vec<ChatStreamEventPayload> {
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

    // Claude Code tags its synthetic failure message with a bare machine code in a top-level
    // `error` key (e.g. "authentication_failed"); the readable text arrives on the `result` line.
    let is_claude_assistant_line = normalize_engine(engine) == "claude"
        && val.get("type").and_then(|t| t.as_str()) == Some("assistant");

    // Check error payloads first (support top-level error and agy result.error)
    if let Some(err) = val
        .get("error")
        .or_else(|| val.get("result").and_then(|r| r.get("error")))
        .and_then(|e| e.as_str())
        .filter(|s| !s.is_empty() && !is_claude_assistant_line)
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
        "claude" => {
            // `claude -p --output-format stream-json --verbose --include-partial-messages`:
            //   {"type":"stream_event","event":{"type":"message_start"}}
            //   {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}
            //   {"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}   (repeats the deltas)
            //   {"type":"result","is_error":false,"result":"Hi"}                           (repeats the text again)
            match val.get("type").and_then(|t| t.as_str()) {
                Some("stream_event") => {
                    let event = val.get("event");
                    match event.and_then(|e| e.get("type")).and_then(|t| t.as_str()) {
                        Some("message_start") => state.claude_message_streamed = false,
                        Some("content_block_delta") => {
                            if let Some(text) = event
                                .and_then(|e| e.get("delta"))
                                .filter(|d| {
                                    d.get("type").and_then(|t| t.as_str()) == Some("text_delta")
                                })
                                .and_then(|d| d.get("text"))
                                .and_then(|t| t.as_str())
                            {
                                state.claude_message_streamed = true;
                                events.push(ChatStreamEventPayload::Token {
                                    token: text.to_string(),
                                });
                            }
                        }
                        _ => {}
                    }
                }
                Some("assistant") => {
                    // Only fall back to the completed message when no deltas were streamed for it.
                    // A line tagged with `error` is a synthetic failure notice, not reply text.
                    if !state.claude_message_streamed && val.get("error").is_none() {
                        if let Some(content) = val
                            .get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_array())
                        {
                            for text in content
                                .iter()
                                .filter(|part| {
                                    part.get("type").and_then(|t| t.as_str()) == Some("text")
                                })
                                .filter_map(|part| part.get("text").and_then(|t| t.as_str()))
                            {
                                events.push(ChatStreamEventPayload::Token {
                                    token: text.to_string(),
                                });
                            }
                        }
                    }
                }
                // The text was already emitted; only surface failures (e.g. "Not logged in").
                Some("result") if val.get("is_error").and_then(|e| e.as_bool()) == Some(true) => {
                    let error = val
                        .get("result")
                        .and_then(|r| r.as_str())
                        .filter(|r| !r.is_empty())
                        .map(str::to_string)
                        .or_else(|| {
                            val.get("subtype")
                                .and_then(|t| t.as_str())
                                .map(str::to_string)
                        })
                        .unwrap_or_else(|| "Claude Code reported an error".to_string());
                    events.push(ChatStreamEventPayload::Error { error });
                }
                _ => {}
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

/// Probes Google Antigravity account status from ~/.gemini/google_accounts.json and settings.json
pub fn probe_agy_account() -> Option<CliAccountInfo> {
    let home = resolve_home_dir()?;
    probe_agy_account_in(&home)
}

/// Probes Google Antigravity account status in the given home directory.
pub fn probe_agy_account_in(home: &Path) -> Option<CliAccountInfo> {
    let accounts_file = home.join(".gemini/google_accounts.json");
    if !accounts_file.is_file() {
        return None;
    }

    let content = std::fs::read_to_string(&accounts_file).ok()?;
    let doc: serde_json::Value = serde_json::from_str(&content).ok()?;
    let active_email = doc
        .get("active")
        .and_then(|v| v.as_str())?
        .trim()
        .to_string();
    if active_email.is_empty() {
        return None;
    }

    let mut plan_type = None;
    let settings_file = home.join(".gemini/settings.json");
    if let Ok(settings_content) = std::fs::read_to_string(&settings_file) {
        if let Ok(settings_doc) = serde_json::from_str::<serde_json::Value>(&settings_content) {
            if let Some(auth_type) = settings_doc
                .get("security")
                .and_then(|s| s.get("auth"))
                .and_then(|a| a.get("selectedType"))
                .and_then(|t| t.as_str())
            {
                let clean_plan = auth_type.strip_prefix("oauth-").unwrap_or(auth_type);
                plan_type = Some(clean_plan.to_string());
            }
        }
    }

    Some(CliAccountInfo {
        email: Some(active_email),
        plan_type,
        quota_used_percent: None,
        quota_resets_at: None,
    })
}

/// Probes Claude Code account status from ~/.claude.json
pub fn probe_claude_account() -> Option<CliAccountInfo> {
    let home = resolve_home_dir()?;
    probe_claude_account_in(&home)
}

/// Probes Claude Code account status in the given home directory.
pub fn probe_claude_account_in(home: &Path) -> Option<CliAccountInfo> {
    let claude_file = home.join(".claude.json");
    if !claude_file.is_file() {
        return None;
    }

    let content = std::fs::read_to_string(&claude_file).ok()?;
    let doc: serde_json::Value = serde_json::from_str(&content).ok()?;
    let oauth = doc.get("oauthAccount")?;
    let email = oauth
        .get("emailAddress")
        .and_then(|v| v.as_str())?
        .trim()
        .to_string();
    if email.is_empty() {
        return None;
    }

    let plan_type = oauth
        .get("seatTier")
        .or_else(|| oauth.get("billingType"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(CliAccountInfo {
        email: Some(email),
        plan_type,
        quota_used_percent: None,
        quota_resets_at: None,
    })
}

/// Resolves and ensures the existence of Asyar's dedicated CLI workspace directory
/// (`<app_data_dir>/cli-workspace`).
pub fn resolve_cli_workspace_dir(app_data_dir: &Path) -> Result<PathBuf, AppError> {
    let workspace = app_data_dir.join("cli-workspace");
    std::fs::create_dir_all(&workspace).map_err(|e| {
        AppError::Other(format!(
            "Failed to create CLI workspace directory at {workspace:?}: {e}"
        ))
    })?;

    Ok(workspace)
}

/// Resolves and ensures the existence of Asyar's dedicated CODEX_HOME directory
/// (`<app_data_dir>/codex-home`), which is kept as a sibling outside of `cli-workspace`.
pub fn resolve_codex_home_dir(app_data_dir: &Path) -> Result<PathBuf, AppError> {
    let codex_home = app_data_dir.join("codex-home");
    std::fs::create_dir_all(&codex_home).map_err(|e| {
        AppError::Other(format!(
            "Failed to create CODEX_HOME directory at {codex_home:?}: {e}"
        ))
    })?;
    Ok(codex_home)
}

/// Resolves the executable path to use for Asyar's built-in MCP server (`asyar mcp-server --allow ...`).
/// Accepts an optional explicit path (used by tests).
pub fn resolve_asyar_mcp_exe_path(explicit_exe: Option<&Path>) -> String {
    match explicit_exe {
        Some(p) => p.to_string_lossy().to_string(),
        None => std::env::current_exe()
            .unwrap_or_else(|_| PathBuf::from("asyar"))
            .to_string_lossy()
            .to_string(),
    }
}

/// Returns true if the tool name represents a built-in Asyar tool.
pub fn is_cli_builtin_tool_name(name: &str) -> bool {
    name.starts_with("builtin:") || name.starts_with("builtin__")
}

/// Extracts bare ID of a built-in tool (e.g. "builtin:calculator" -> "calculator").
pub fn extract_cli_builtin_tool_name(name: &str) -> Option<&str> {
    name.strip_prefix("builtin:")
        .or_else(|| name.strip_prefix("builtin__"))
}

/// Returns the tool definitions that will be dropped for a CLI run with the given engine.
///
/// - Google Antigravity ("google") supports no tools in CLI mode; every tool is dropped.
/// - Claude Code ("claude") and Codex ("openai") support only built-in tools (prefixed with `builtin:` or `builtin__`);
///   extension tools and MCP tools are dropped.
/// - Any other engine in CLI mode supports no tools; every tool is dropped.
pub fn dropped_cli_tools<'a>(
    engine: &str,
    tools: &'a [crate::ai::types::ToolDefinition],
) -> Vec<&'a crate::ai::types::ToolDefinition> {
    match normalize_engine(engine) {
        "claude" | "openai" => tools
            .iter()
            .filter(|tool| !is_cli_builtin_tool_name(&tool.name))
            .collect(),
        _ => tools.iter().collect(),
    }
}

/// Returns the tool definitions that will be dropped for a run with the given engine and connection mode.
///
/// In API mode (`connection_mode != Some("cli")`), no tools are dropped (returns empty).
/// In CLI mode (`connection_mode == Some("cli")`), delegates to [`dropped_cli_tools`].
pub fn dropped_tools<'a>(
    engine: &str,
    connection_mode: Option<&str>,
    tools: &'a [crate::ai::types::ToolDefinition],
) -> Vec<&'a crate::ai::types::ToolDefinition> {
    if connection_mode != Some("cli") {
        return Vec::new();
    }
    dropped_cli_tools(engine, tools)
}

/// Extracts bare IDs of built-in tools supported by this CLI engine, logging a warning for any dropped tools.
pub fn filter_cli_builtin_tools(
    engine: &str,
    tools: &[crate::ai::types::ToolDefinition],
) -> Vec<String> {
    let dropped = dropped_cli_tools(engine, tools);
    for tool in &dropped {
        log::warn!(
            "[cli] Dropping tool '{}' for {engine} CLI run; not supported in CLI mode",
            tool.name
        );
    }
    tools
        .iter()
        .filter(|tool| !dropped.iter().any(|d| d.name == tool.name))
        .filter_map(|tool| extract_cli_builtin_tool_name(&tool.name).map(str::to_string))
        .collect()
}

/// Builds the argument list for a non-interactive `claude` run with the default binary path.
pub fn claude_cli_args(
    prompt: &str,
    model: &str,
    effort: Option<&str>,
    allowed_builtins: &[&str],
) -> Vec<String> {
    claude_cli_args_with_exe(prompt, model, effort, allowed_builtins, None)
}

/// Builds the argument list for a non-interactive `claude` run, optionally taking an explicit executable path.
pub fn claude_cli_args_with_exe(
    prompt: &str,
    model: &str,
    effort: Option<&str>,
    allowed_builtins: &[&str],
    exe_path: Option<&Path>,
) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--disable-slash-commands",
        "--permission-mode",
        "dontAsk",
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
    ]
    .into_iter()
    .map(String::from)
    .collect();

    let mut unique_builtins: Vec<&str> = Vec::new();
    for id in allowed_builtins {
        if !unique_builtins.contains(id) {
            unique_builtins.push(*id);
        }
    }

    if !unique_builtins.is_empty() {
        let exe = resolve_asyar_mcp_exe_path(exe_path);

        let allow_arg = unique_builtins.join(",");
        let mcp_config = serde_json::json!({
            "mcpServers": {
                "asyar": {
                    "command": exe,
                    "args": ["mcp-server", "--allow", allow_arg]
                }
            }
        });

        args.push("--mcp-config".into());
        args.push(mcp_config.to_string());

        args.push("--allowedTools".into());
        for id in &unique_builtins {
            args.push(format!("mcp__asyar__{id}"));
        }
    }

    if !model.is_empty() {
        args.push("--model".into());
        args.push(model.into());
    }
    if let Some(effort) =
        effort.filter(|e| matches!(*e, "low" | "medium" | "high" | "xhigh" | "max"))
    {
        args.push("--effort".into());
        args.push(effort.into());
    }
    args
}

/// Builds the argument list for a non-interactive `agy` run.
pub fn agy_cli_args(prompt: &str, model: &str, effort: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--disable-slash-commands",
        "--sandbox",
    ]
    .into_iter()
    .map(String::from)
    .collect();

    let model = model.trim();
    // If the model is an obsolete/incompatible API-only model name like "gemini-2.5-flash", "gemini-1.5-flash", etc.,
    // omit --model so agy uses its configured default model instead of crashing with invalid model selection.
    if !model.is_empty() && !model.starts_with("gemini-1.") && !model.starts_with("gemini-2.") {
        args.push("--model".into());
        args.push(model.into());
    }

    if let Some(effort) = effort {
        if matches!(effort, "low" | "medium" | "high" | "xhigh" | "max")
            && !model.ends_with("-low")
            && !model.ends_with("-medium")
            && !model.ends_with("-high")
        {
            args.push("--effort".into());
            args.push(effort.into());
        }
    }

    args
}

/// Builds the Tokio `Command` to spawn agy CLI with the given settings.
pub fn build_agy_command(
    bin_path: &Path,
    prompt: &str,
    model: &str,
    effort: Option<&str>,
    workspace_dir: &Path,
) -> Command {
    let mut cmd = Command::new(bin_path);
    cmd.current_dir(workspace_dir);
    cmd.args(agy_cli_args(prompt, model, effort));
    cmd
}

/// Builds the Tokio `Command` to spawn Claude CLI with the given settings.
pub fn build_claude_command(
    bin_path: &Path,
    prompt: &str,
    model: &str,
    effort: Option<&str>,
    allowed_builtins: &[&str],
    workspace_dir: &Path,
) -> Command {
    let mut cmd = Command::new(bin_path);
    cmd.current_dir(workspace_dir);
    cmd.args(claude_cli_args(prompt, model, effort, allowed_builtins));
    cmd
}

/// Picks the message reported when a CLI process exits non-zero. Claude Code writes its
/// failures (e.g. an expired login) to stdout as JSON and leaves stderr empty, so the error
/// already seen on the stream beats a bare exit code.
fn cli_failure_message(stderr: &str, stream_error: Option<&str>, status: &str) -> String {
    if !stderr.trim().is_empty() {
        stderr.to_string()
    } else if let Some(err) = stream_error.filter(|e| !e.trim().is_empty()) {
        err.to_string()
    } else {
        format!("CLI process exited with code {status}")
    }
}

/// Executes a prompt using a local CLI runtime process and streams tokens back to `on_event`.
#[allow(clippy::too_many_arguments)]
pub async fn cli_stream_chat_impl<F>(
    provider_id: &str,
    config: ProviderConfig,
    messages: Vec<ChatMessage>,
    params: ChatParams,
    _stream_id: String,
    workspace_dir: &Path,
    codex_home_dir: &Path,
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

    if normalize_engine(engine_type) == "openai" {
        let model = if params.model_id.trim().is_empty() {
            None
        } else {
            Some(params.model_id.trim())
        };
        let allowed_builtins =
            filter_cli_builtin_tools(engine_type, params.tools.as_deref().unwrap_or(&[]));
        let allowed_refs: Vec<&str> = allowed_builtins.iter().map(String::as_str).collect();
        return crate::ai::codex_client::CodexClient::stream_turn(
            &bin_path,
            &prompt,
            model,
            config.reasoning_effort.as_deref(),
            &allowed_refs,
            workspace_dir,
            codex_home_dir,
            on_event,
        )
        .await;
    }

    log::debug!(
        "[cli] Spawning {engine_type} process with working directory: {:?}",
        workspace_dir
    );

    let mut cmd = match normalize_engine(engine_type) {
        "google" => {
            let _ = filter_cli_builtin_tools(engine_type, params.tools.as_deref().unwrap_or(&[]));
            build_agy_command(
                &bin_path,
                &prompt,
                params.model_id.trim(),
                config.reasoning_effort.as_deref(),
                workspace_dir,
            )
        }
        "claude" => {
            let allowed_builtins =
                filter_cli_builtin_tools(engine_type, params.tools.as_deref().unwrap_or(&[]));
            let allowed_refs: Vec<&str> = allowed_builtins.iter().map(String::as_str).collect();
            build_claude_command(
                &bin_path,
                &prompt,
                params.model_id.trim(),
                config.reasoning_effort.as_deref(),
                &allowed_refs,
                workspace_dir,
            )
        }
        _ => {
            let mut cmd = Command::new(&bin_path);
            cmd.current_dir(workspace_dir);
            cmd.arg(&prompt);
            cmd
        }
    };

    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    hide_console_window(&mut cmd);

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
    let mut stream_state = CliStreamState::default();
    let mut stream_error: Option<String> = None;

    while let Some(line_res) = out_lines.next().await {
        match line_res {
            Ok(line) => {
                let payloads =
                    parse_cli_stream_line_stateful(engine_type, &line, &mut stream_state);
                for payload in payloads {
                    if let ChatStreamEventPayload::Error { error } = &payload {
                        stream_error = Some(error.clone());
                    }
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
        let err_msg = cli_failure_message(
            &captured_stderr,
            stream_error.as_deref(),
            &status.to_string(),
        );
        // The stream already reported this; re-emitting would only repeat it.
        if stream_error.as_deref() != Some(err_msg.as_str()) {
            on_event(ChatStreamEventPayload::Error {
                error: err_msg.clone(),
            });
        }
        return Err(AppError::Other(err_msg));
    }

    on_event(ChatStreamEventPayload::Done);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_home_dir_is_some() {
        // Falls back to the platform home dir when HOME is unset (Windows).
        assert!(super::resolve_home_dir().is_some());
    }

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
    fn test_cli_candidates_include_claude_install_locations() {
        let candidates = cli_candidates("anthropic_16782567");
        assert!(candidates.iter().any(|p| p.ends_with(".local/bin/claude")));
        #[cfg(windows)]
        assert!(candidates
            .iter()
            .any(|p| p.ends_with(".local/bin/claude.exe")));
    }

    fn token_text(events: &[ChatStreamEventPayload]) -> String {
        events
            .iter()
            .filter_map(|e| match e {
                ChatStreamEventPayload::Token { token } => Some(token.as_str()),
                _ => None,
            })
            .collect()
    }

    /// Feeds lines captured from a real `claude -p --output-format stream-json --verbose
    /// --include-partial-messages` run through the stateful parser.
    fn run_claude_stream(lines: &[&str]) -> Vec<ChatStreamEventPayload> {
        let mut state = CliStreamState::default();
        lines
            .iter()
            .flat_map(|l| parse_cli_stream_line_stateful("anthropic_1", l, &mut state))
            .collect()
    }

    #[test]
    fn test_parse_claude_stream_does_not_duplicate_text() {
        let events = run_claude_stream(&[
            r#"{"type":"system","subtype":"init"}"#,
            r#"{"type":"stream_event","event":{"type":"message_start"}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":""}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hey"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":", what's up?"}}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hey, what's up?"}]}}"#,
            r#"{"type":"stream_event","event":{"type":"message_stop"}}"#,
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Hey, what's up?"}"#,
        ]);
        assert_eq!(token_text(&events), "Hey, what's up?");
        assert!(!events
            .iter()
            .any(|e| matches!(e, ChatStreamEventPayload::Error { .. })));
    }

    #[test]
    fn test_parse_claude_stream_falls_back_to_assistant_message_without_deltas() {
        let events = run_claude_stream(&[
            r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"Hello"}]}}"#,
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Hello"}"#,
        ]);
        assert_eq!(token_text(&events), "Hello");
    }

    #[test]
    fn test_parse_claude_stream_multiple_messages_after_tool_use() {
        let events = run_claude_stream(&[
            r#"{"type":"stream_event","event":{"type":"message_start"}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Checking. "}}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Checking. "},{"type":"tool_use","name":"Bash"}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#,
            r#"{"type":"stream_event","event":{"type":"message_start"}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Done."}]}}"#,
            r#"{"type":"result","is_error":false,"result":"Done."}"#,
        ]);
        // The second message had no deltas, so its completed text must not be lost.
        assert_eq!(token_text(&events), "Checking. Done.");
    }

    #[test]
    fn test_parse_claude_stream_surfaces_errors() {
        let events = run_claude_stream(&[
            r#"{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}"#,
        ]);
        assert!(token_text(&events).is_empty());
        assert!(matches!(
            events.as_slice(),
            [ChatStreamEventPayload::Error { error }] if error.contains("Not logged in")
        ));
    }

    #[test]
    fn test_parse_claude_auth_failure_yields_only_the_readable_message() {
        // Captured from `claude -p --output-format stream-json` with an expired login: the
        // synthetic assistant line carries a machine code in a top-level `error` key and the
        // human-readable text only in the `result` line.
        let events = run_claude_stream(&[
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Failed to authenticate: OAuth session expired and could not be refreshed"}]},"error":"authentication_failed"}"#,
            r#"{"type":"result","subtype":"success","is_error":true,"result":"Failed to authenticate: OAuth session expired and could not be refreshed"}"#,
        ]);
        assert!(token_text(&events).is_empty());
        assert!(matches!(
            events.as_slice(),
            [ChatStreamEventPayload::Error { error }] if error.contains("OAuth session expired")
        ));
    }

    #[test]
    fn test_cli_failure_message_prefers_stderr_then_stream_error_then_exit_code() {
        assert_eq!(
            cli_failure_message("boom\n", Some("stream"), "exit status: 1"),
            "boom\n"
        );
        assert_eq!(
            cli_failure_message("  ", Some("Not logged in"), "exit status: 1"),
            "Not logged in"
        );
        assert_eq!(
            cli_failure_message("", None, "exit status: 1"),
            "CLI process exited with code exit status: 1"
        );
    }

    #[test]
    fn test_claude_cli_args_flags_and_safety() {
        let args = claude_cli_args("hello", "sonnet", Some("high"), &[]);
        assert_eq!(&args[..2], ["-p", "hello"]);
        // Must never contain permission bypass flags
        assert!(!args.iter().any(|a| a == "bypassPermissions"));
        assert!(!args.iter().any(|a| a == "--dangerously-skip-permissions"));

        // Must enforce restricted permissions and settings
        let pos = |flag: &str| args.iter().position(|a| a == flag).unwrap();
        assert_eq!(args[pos("--permission-mode") + 1], "dontAsk");
        assert_eq!(args[pos("--tools") + 1], "");
        assert!(args.iter().any(|a| a == "--strict-mcp-config"));
        assert_eq!(args[pos("--setting-sources") + 1], "");

        assert_eq!(args[pos("--model") + 1], "sonnet");
        assert_eq!(args[pos("--effort") + 1], "high");

        let bare = claude_cli_args("hello", "", None, &[]);
        assert!(!bare.iter().any(|a| a == "--model" || a == "--effort"));
        let bogus = claude_cli_args("hello", "", Some("bogus"), &[]);
        assert!(!bogus.iter().any(|a| a == "--effort"));
    }

    #[test]
    fn test_claude_cli_args_without_builtins_has_no_mcp_config() {
        let args = claude_cli_args("hello", "", None, &[]);
        assert!(!args.iter().any(|a| a == "--mcp-config"));
        assert!(!args.iter().any(|a| a == "--allowedTools"));
    }

    #[test]
    fn test_claude_cli_args_with_builtins() {
        let exe = Path::new("/custom/bin/asyar");
        let args = claude_cli_args_with_exe(
            "hello",
            "sonnet",
            None,
            &["calculator", "web-search"],
            Some(exe),
        );

        let mcp_pos = args.iter().position(|a| a == "--mcp-config").unwrap();
        let mcp_json: serde_json::Value =
            serde_json::from_str(&args[mcp_pos + 1]).expect("valid json in --mcp-config");

        let servers = mcp_json["mcpServers"]
            .as_object()
            .expect("mcpServers object");
        assert_eq!(servers.len(), 1, "must define exactly one server");
        assert!(servers.contains_key("asyar"));

        assert_eq!(servers["asyar"]["command"], "/custom/bin/asyar");
        assert_eq!(
            servers["asyar"]["args"],
            serde_json::json!(["mcp-server", "--allow", "calculator,web-search"])
        );

        let allowed_pos = args.iter().position(|a| a == "--allowedTools").unwrap();
        assert_eq!(args[allowed_pos + 1], "mcp__asyar__calculator");
        assert_eq!(args[allowed_pos + 2], "mcp__asyar__web-search");
    }

    #[test]
    fn test_filter_cli_builtin_tools() {
        use crate::ai::types::ToolDefinition;
        let tools = vec![
            ToolDefinition {
                name: "builtin:calculator".into(),
                description: "calc".into(),
                parameters: serde_json::json!({}),
            },
            ToolDefinition {
                name: "builtin__web-search".into(),
                description: "search".into(),
                parameters: serde_json::json!({}),
            },
            ToolDefinition {
                name: "extension__weather__current".into(),
                description: "weather".into(),
                parameters: serde_json::json!({}),
            },
            ToolDefinition {
                name: "mcp__github__create_issue".into(),
                description: "github".into(),
                parameters: serde_json::json!({}),
            },
        ];

        let filtered_claude = filter_cli_builtin_tools("claude", &tools);
        assert_eq!(filtered_claude, vec!["calculator", "web-search"]);

        let filtered_codex = filter_cli_builtin_tools("openai", &tools);
        assert_eq!(filtered_codex, vec!["calculator", "web-search"]);

        let filtered_agy = filter_cli_builtin_tools("google", &tools);
        assert!(filtered_agy.is_empty());
    }

    #[test]
    fn test_dropped_tools_pure_function() {
        use crate::ai::types::ToolDefinition;
        let tools = vec![
            ToolDefinition {
                name: "builtin:calculator".into(),
                description: "calc".into(),
                parameters: serde_json::json!({}),
            },
            ToolDefinition {
                name: "builtin__web-search".into(),
                description: "search".into(),
                parameters: serde_json::json!({}),
            },
            ToolDefinition {
                name: "extension__weather__current".into(),
                description: "weather".into(),
                parameters: serde_json::json!({}),
            },
            ToolDefinition {
                name: "mcp__github__create_issue".into(),
                description: "github".into(),
                parameters: serde_json::json!({}),
            },
        ];

        // Claude CLI: keeps built-ins, drops extension and MCP tools
        let dropped_claude = dropped_tools("claude", Some("cli"), &tools);
        assert_eq!(
            dropped_claude
                .iter()
                .map(|t| t.name.as_str())
                .collect::<Vec<_>>(),
            vec!["extension__weather__current", "mcp__github__create_issue"]
        );

        // Codex CLI: keeps built-ins, drops extension and MCP tools
        let dropped_codex = dropped_tools("openai", Some("cli"), &tools);
        assert_eq!(
            dropped_codex
                .iter()
                .map(|t| t.name.as_str())
                .collect::<Vec<_>>(),
            vec!["extension__weather__current", "mcp__github__create_issue"]
        );

        // agy (Google Antigravity CLI): drops all tools (both built-in and external)
        let dropped_agy = dropped_tools("google", Some("cli"), &tools);
        assert_eq!(
            dropped_agy
                .iter()
                .map(|t| t.name.as_str())
                .collect::<Vec<_>>(),
            vec![
                "builtin:calculator",
                "builtin__web-search",
                "extension__weather__current",
                "mcp__github__create_issue"
            ]
        );

        // Empty in -> empty out across all engines
        assert!(dropped_tools("claude", Some("cli"), &[]).is_empty());
        assert!(dropped_tools("openai", Some("cli"), &[]).is_empty());
        assert!(dropped_tools("google", Some("cli"), &[]).is_empty());

        // API mode -> nothing dropped across all engines
        assert!(dropped_tools("claude", Some("api"), &tools).is_empty());
        assert!(dropped_tools("claude", None, &tools).is_empty());
        assert!(dropped_tools("openai", Some("api"), &tools).is_empty());
        assert!(dropped_tools("openai", None, &tools).is_empty());
        assert!(dropped_tools("google", Some("api"), &tools).is_empty());
        assert!(dropped_tools("google", None, &tools).is_empty());
    }

    #[test]
    fn test_build_claude_command_uses_cli_workspace_directory() {
        let bin_path = PathBuf::from("/usr/local/bin/claude");
        let temp = tempfile::tempdir().unwrap();
        let workspace = temp.path().join("cli-workspace");
        std::fs::create_dir_all(&workspace).unwrap();

        let cmd = build_claude_command(&bin_path, "prompt", "model", None, &[], &workspace);
        assert_eq!(cmd.as_std().get_current_dir(), Some(workspace.as_path()));
    }

    #[test]
    fn test_resolve_cli_workspace_dir_creates_dir() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = resolve_cli_workspace_dir(temp.path()).unwrap();
        assert_eq!(workspace, temp.path().join("cli-workspace"));
        assert!(workspace.is_dir());
    }

    #[test]
    fn test_resolve_codex_home_dir_is_sibling_outside_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = resolve_cli_workspace_dir(temp.path()).unwrap();
        let codex_home = resolve_codex_home_dir(temp.path()).unwrap();

        assert_eq!(workspace, temp.path().join("cli-workspace"));
        assert_eq!(codex_home, temp.path().join("codex-home"));
        assert_ne!(workspace, codex_home);
        assert!(!codex_home.starts_with(&workspace));
        assert!(!workspace.starts_with(&codex_home));
        assert!(codex_home.is_dir());
    }

    #[test]
    fn test_resolve_asyar_mcp_exe_path() {
        let explicit = Path::new("/custom/bin/asyar");
        assert_eq!(
            resolve_asyar_mcp_exe_path(Some(explicit)),
            "/custom/bin/asyar"
        );
        let default_exe = resolve_asyar_mcp_exe_path(None);
        assert!(!default_exe.is_empty());
    }

    #[test]
    fn test_resolve_cli_workspace_dir_dev_vs_prod_path() {
        let temp = tempfile::tempdir().unwrap();
        let dev_data_dir = temp.path().join("org.asyar.dev");
        let prod_data_dir = temp.path().join("org.asyar");

        let dev_workspace = resolve_cli_workspace_dir(&dev_data_dir).unwrap();
        assert_eq!(dev_workspace, dev_data_dir.join("cli-workspace"));
        assert!(dev_workspace.is_dir());

        let prod_workspace = resolve_cli_workspace_dir(&prod_data_dir).unwrap();
        assert_eq!(prod_workspace, prod_data_dir.join("cli-workspace"));
        assert!(prod_workspace.is_dir());

        assert_ne!(dev_workspace, prod_workspace);
    }

    #[test]
    fn test_build_agy_command_argv_and_cwd() {
        let bin_path = PathBuf::from("/usr/local/bin/agy");
        let temp = tempfile::tempdir().unwrap();
        let workspace = temp.path().join("cli-workspace");
        std::fs::create_dir_all(&workspace).unwrap();

        let cmd = build_agy_command(
            &bin_path,
            "Say hi",
            "gemini-3.0-flash",
            Some("high"),
            &workspace,
        );
        assert_eq!(cmd.as_std().get_current_dir(), Some(workspace.as_path()));

        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().to_string())
            .collect();

        assert!(args.contains(&"--sandbox".to_string()));
        assert!(args.contains(&"--disable-slash-commands".to_string()));
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"Say hi".to_string()));
        assert!(args.contains(&"--output-format".to_string()));
        assert!(args.contains(&"stream-json".to_string()));
        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"gemini-3.0-flash".to_string()));
        assert!(args.contains(&"--effort".to_string()));
        assert!(args.contains(&"high".to_string()));
        assert!(!args.contains(&"--dangerously-skip-permissions".to_string()));
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
    fn test_probe_agy_account_in_temp_home() {
        let temp_dir = tempfile::tempdir().unwrap();
        let gemini_dir = temp_dir.path().join(".gemini");
        std::fs::create_dir_all(&gemini_dir).unwrap();

        let accounts = serde_json::json!({
            "active": "tester@example.com"
        });
        std::fs::write(
            gemini_dir.join("google_accounts.json"),
            accounts.to_string(),
        )
        .unwrap();

        let settings = serde_json::json!({
            "security": {
                "auth": {
                    "selectedType": "oauth-personal"
                }
            }
        });
        std::fs::write(gemini_dir.join("settings.json"), settings.to_string()).unwrap();

        let account = probe_agy_account_in(temp_dir.path()).expect("Should parse test agy account");
        assert_eq!(account.email.as_deref(), Some("tester@example.com"));
        assert_eq!(account.plan_type.as_deref(), Some("personal"));
    }

    #[test]
    fn test_probe_claude_account_in_temp_home() {
        let temp_dir = tempfile::tempdir().unwrap();
        let claude_file = temp_dir.path().join(".claude.json");

        let claude_doc = serde_json::json!({
            "oauthAccount": {
                "emailAddress": "claude-tester@example.com",
                "seatTier": "team"
            }
        });
        std::fs::write(&claude_file, claude_doc.to_string()).unwrap();

        let account =
            probe_claude_account_in(temp_dir.path()).expect("Should parse test claude account");
        assert_eq!(account.email.as_deref(), Some("claude-tester@example.com"));
        assert_eq!(account.plan_type.as_deref(), Some("team"));
    }

    #[tokio::test]
    async fn test_check_cli_status_missing_binary_in_isolated_env() {
        let temp_dir = tempfile::tempdir().unwrap();
        let status = check_cli_status_in(
            "nonexistent_engine_test",
            Some("/path/that/does/not/exist/bin"),
            Some(temp_dir.path()),
        )
        .await;

        assert!(!status.installed);
        assert!(status.version.is_none());
        assert!(status.error.is_some());
        assert!(status.account.is_none());
    }
}
