use crate::agents::tools::{ManifestTool, ToolRegistryState};
use crate::error::AppError;
use crate::mcp::supervisor::McpSupervisor;
use crate::mcp::tool_adapter::descriptors_from_mcp_tools;
use crate::mcp::types::{McpServerConfig, McpServerStatus, McpTransportSpec};
use crate::storage::mcp_servers::{insert_server, list_servers, McpServerRow};
use crate::storage::DataStore;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

// ── Public data types ─────────────────────────────────────────────────────────

/// Input for installing or testing an MCP server.
/// `transport` uses the standard `McpTransportSpec` shape for serialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInstallInput {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub transport: McpTransportSpec,
}

/// Summary of a persisted MCP server with live status.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSummary {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub transport_kind: String,
    pub enabled: bool,
    pub status: McpServerStatus,
    pub tools_count: u32,
}

/// Result of a non-persisting probe of an MCP server endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestResult {
    pub tools_count: u32,
    pub error: Option<String>,
}

/// A detected MCP config file with its parsed server list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedConfig {
    /// One of: "claude_desktop" | "cursor" | "cline" | "continue" | "zed" | "windsurf"
    pub source: String,
    pub path: String,
    pub servers: Vec<McpServerInstallInput>,
}

// ── install_server ────────────────────────────────────────────────────────────

/// Installs an MCP server: validates, probes for tools, persists to SQLite,
/// registers with the supervisor, and registers tools in the tool registry.
pub async fn install_server(
    supervisor: &McpSupervisor,
    registry: &ToolRegistryState,
    store: &DataStore,
    input: McpServerInstallInput,
) -> Result<McpServerSummary, AppError> {
    if input.id.trim().is_empty() {
        return Err(AppError::Validation(
            "server id must not be empty".to_string(),
        ));
    }
    if input.display_name.trim().is_empty() {
        return Err(AppError::Validation(
            "display_name must not be empty".to_string(),
        ));
    }

    // Probe: connect once, list tools, then disconnect. This validates the
    // transport spec before we commit anything to SQLite.
    let factory = supervisor.factory();
    let tools = McpSupervisor::connect_and_list_tools(factory, &input.transport)
        .await
        .map_err(|e| {
            AppError::Other(format!("MCP server '{}' handshake failed: {}", input.id, e))
        })?;

    let tools_count = tools.len() as u32;
    let manifest_tools: Vec<ManifestTool> = descriptors_from_mcp_tools(&input.id, tools);

    // Persist to SQLite.
    let now = now_millis();
    let row = input_to_row(&input, true, now);
    {
        let conn = store.conn()?;
        insert_server(&conn, &row)?;
    }

    // Start the persistent supervisor watchdog.
    let config = McpServerConfig {
        id: input.id.clone(),
        display_name: input.display_name.clone(),
        transport: input.transport.clone(),
        enabled: true,
    };
    supervisor.enable(config).await.map_err(|e| {
        AppError::Other(format!(
            "Failed to start supervisor for MCP server '{}': {}",
            input.id, e
        ))
    })?;

    // Register tools in the tool registry.
    registry
        .register_mcp(&input.id, manifest_tools)
        .map_err(|e| {
            AppError::Other(format!(
                "Failed to register tools for MCP server '{}': {}",
                input.id, e
            ))
        })?;

    let status = supervisor
        .status(&input.id)
        .await
        .unwrap_or(McpServerStatus::Starting);

    Ok(McpServerSummary {
        id: input.id,
        display_name: input.display_name,
        description: input.description,
        transport_kind: row.transport_kind,
        enabled: true,
        status,
        tools_count,
    })
}

// ── install_server_checking_runtime ───────────────────────────────────────────

/// Whether a bundled runtime (bun/uv) still needs to be downloaded before an
/// install/enable can proceed. Implemented by a thin production adapter over
/// `runtimes::RuntimeManager::ensure` at the Tauri command layer; kept as a
/// trait so `install_server_checking_runtime`'s own tests can use a fixed
/// stub instead of the real download/network stack.
pub trait RuntimeAvailability: Send + Sync {
    /// `Some(size_bytes)` when `name` still needs to be downloaded, `None`
    /// when it's already installed (or not a runtime this check cares about).
    fn needs_download(&self, name: &str) -> Option<u64>;
}

/// Outcome of `install_server_checking_runtime`: either the server was
/// probed and persisted normally, or a required bundled runtime is missing
/// and the caller must drive a consent+download flow before retrying.
#[derive(Debug, Clone, PartialEq)]
pub enum InstallOutcome {
    Installed(McpServerSummary),
    NeedsRuntime { name: String, size_bytes: u64 },
}

/// Maps a stdio server's `command` to the bundled runtime it needs — but
/// only when `path_probe` reports the command is NOT already on the system
/// `PATH` (fix #3: install/enable-time checks must agree with the actual
/// spawn-time resolution in `transport::resolve_stdio_command`, which always
/// prefers PATH first). `None` for `Http` transports, commands found on
/// PATH, and any command that never routes through a bundled runtime.
/// Delegates the command→runtime name mapping to `sidecar::runtime_for_command`
/// (single source of truth — see that function's doc comment) rather than
/// duplicating it here.
pub(crate) fn required_runtime_for_command_with_probe(
    transport: &McpTransportSpec,
    path_probe: impl Fn(&str) -> bool,
) -> Option<&'static str> {
    match transport {
        McpTransportSpec::Stdio { command, .. } => {
            if path_probe(command) {
                return None;
            }
            crate::mcp::sidecar::runtime_for_command(command)
        }
        McpTransportSpec::Http { .. } => None,
    }
}

/// Like `install_server`, but first checks whether the server's transport
/// needs a bundled runtime (bun/uv) that isn't installed yet, returning
/// `InstallOutcome::NeedsRuntime` instead of persisting a server the caller
/// can't actually run. Nothing is written to SQLite (nor is the
/// supervisor/tool registry touched) until the runtime check passes. On a
/// successful install that did need a runtime, registers `"mcp:<id>"` as a
/// consumer of it so Settings' "remove runtime" warning knows this server
/// depends on it. `path_probe` is injectable so tests don't depend on the
/// ambient system PATH (production passes `sidecar::system_command_exists`
/// via `install_server_checking_runtime_ensuring`). `runtime_manager` takes
/// no `AppHandle`, so this whole function stays unit-testable without one —
/// unlike `install_server_checking_runtime_ensuring`, which needs a concrete
/// `&tauri::AppHandle` for its network-backed `ensure()` call and so isn't
/// directly constructible from `tauri::test::mock_app()`.
pub async fn install_server_checking_runtime(
    supervisor: &McpSupervisor,
    registry: &ToolRegistryState,
    store: &DataStore,
    input: McpServerInstallInput,
    runtime_availability: &dyn RuntimeAvailability,
    path_probe: impl Fn(&str) -> bool,
    runtime_manager: &crate::runtimes::RuntimeManager,
) -> Result<InstallOutcome, AppError> {
    let server_id = input.id.clone();
    let required_runtime = required_runtime_for_command_with_probe(&input.transport, path_probe);

    if let Some(name) = required_runtime {
        if let Some(size_bytes) = runtime_availability.needs_download(name) {
            return Ok(InstallOutcome::NeedsRuntime {
                name: name.to_string(),
                size_bytes,
            });
        }
    }

    let summary = install_server(supervisor, registry, store, input).await?;
    if let Some(name) = required_runtime {
        runtime_manager.add_consumer(name, &format!("mcp:{server_id}"));
    }
    Ok(InstallOutcome::Installed(summary))
}

/// A `RuntimeAvailability` scoped to at most one runtime name — the one
/// (if any) a specific transport's command actually needs. Used by
/// `install_server_checking_runtime_ensuring` / the enable-path equivalent
/// in `lifecycle.rs` so the network-backed `RuntimeManager::ensure` call
/// happens at most once, only for the runtime that's actually relevant,
/// instead of unconditionally `ensure()`ing both bun and uv up front (fix #4).
pub(crate) struct SingleRuntimeAvailability {
    entry: Option<(&'static str, u64)>,
}

impl SingleRuntimeAvailability {
    /// No runtime is needed at all (Http transport, or command already on PATH).
    pub(crate) fn none() -> Self {
        Self { entry: None }
    }

    /// Built from a single `RuntimeManager::ensure(name)` result.
    pub(crate) fn from_ensure(name: &'static str, result: crate::runtimes::EnsureResult) -> Self {
        match result {
            crate::runtimes::EnsureResult::Installed(_) => Self { entry: None },
            crate::runtimes::EnsureResult::NeedsDownload { size_bytes } => Self {
                entry: Some((name, size_bytes)),
            },
        }
    }
}

impl RuntimeAvailability for SingleRuntimeAvailability {
    fn needs_download(&self, name: &str) -> Option<u64> {
        self.entry.and_then(|(n, size)| (n == name).then_some(size))
    }
}

/// Production entry point for the install command: determines whether the
/// server's transport needs a bundled runtime (PATH-aware, fix #3) and, only
/// if so, makes a single network `ensure()` call for that one runtime (fix
/// #4) before delegating to `install_server_checking_runtime`. Business
/// logic lives here (not in `commands/mcp.rs`, fix #9) so the Tauri command
/// itself stays a thin wrapper.
pub async fn install_server_checking_runtime_ensuring(
    app_handle: &tauri::AppHandle,
    runtime_manager: &crate::runtimes::RuntimeManager,
    supervisor: &McpSupervisor,
    registry: &ToolRegistryState,
    store: &DataStore,
    input: McpServerInstallInput,
) -> Result<InstallOutcome, AppError> {
    let probe = crate::mcp::sidecar::system_command_exists;
    let availability = match required_runtime_for_command_with_probe(&input.transport, probe) {
        None => SingleRuntimeAvailability::none(),
        Some(name) => {
            let result = runtime_manager.ensure(app_handle, name).await?;
            SingleRuntimeAvailability::from_ensure(name, result)
        }
    };
    install_server_checking_runtime(
        supervisor,
        registry,
        store,
        input,
        &availability,
        probe,
        runtime_manager,
    )
    .await
}

/// Wire shape for `mcp_install_server`'s response (fix #9: lives next to
/// `InstallOutcome`, not in `commands/mcp.rs`). `#[serde(untagged)]` means
/// the normal-success case serializes with no wrapping at all (a plain
/// `McpServerSummary`), while the needs-runtime case carries an explicit
/// `kind: "needsRuntime"` the frontend discriminates on — see
/// `McpService`'s `runtimeConsentPrompt` flow.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum McpInstallOutcomeResponse {
    NeedsRuntime {
        kind: &'static str,
        name: String,
        #[serde(rename = "sizeBytes")]
        size_bytes: u64,
    },
    Installed(McpServerSummary),
}

impl From<InstallOutcome> for McpInstallOutcomeResponse {
    fn from(outcome: InstallOutcome) -> Self {
        match outcome {
            InstallOutcome::Installed(summary) => McpInstallOutcomeResponse::Installed(summary),
            InstallOutcome::NeedsRuntime { name, size_bytes } => {
                McpInstallOutcomeResponse::NeedsRuntime {
                    kind: "needsRuntime",
                    name,
                    size_bytes,
                }
            }
        }
    }
}

// ── test_server ───────────────────────────────────────────────────────────────

/// Probes an MCP server without persisting anything.
/// Returns tool count on success or an error message on failure.
pub async fn test_server(
    factory: Arc<dyn crate::mcp::transport::TransportFactory>,
    input: McpServerInstallInput,
) -> McpTestResult {
    match McpSupervisor::connect_and_list_tools(factory, &input.transport).await {
        Ok(tools) => McpTestResult {
            tools_count: tools.len() as u32,
            error: None,
        },
        Err(e) => McpTestResult {
            tools_count: 0,
            error: Some(format!("{e}")),
        },
    }
}

// ── detect_existing_configs ───────────────────────────────────────────────────

/// Scans known config file locations on the host platform and returns parsed
/// server lists for each file that exists and is parseable.
pub async fn detect_existing_configs() -> Vec<DetectedConfig> {
    detect_existing_configs_with_home(None).await
}

pub(crate) async fn detect_existing_configs_with_home(
    home_override: Option<&std::path::Path>,
) -> Vec<DetectedConfig> {
    let home = match home_override {
        Some(h) => h.to_path_buf(),
        None => match dirs::home_dir() {
            Some(h) => h,
            None => {
                log::warn!("[mcp] detect_existing_configs: could not determine home dir");
                return vec![];
            }
        },
    };

    let paths = config_paths_for_platform(&home);
    let mut result = Vec::new();

    for (source, path) in paths {
        let json = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue, // File doesn't exist or is unreadable — skip silently
        };

        let servers = match parse_mcp_config_json_lenient(&json) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[mcp] could not parse config at {}: {}", path.display(), e);
                continue;
            }
        };

        if servers.is_empty() {
            continue; // Don't show configs with no servers to the user
        }

        result.push(DetectedConfig {
            source,
            path: path.to_string_lossy().to_string(),
            servers,
        });
    }

    result
}

/// Returns the list of (source_label, path) pairs for the current OS.
fn config_paths_for_platform(home: &std::path::Path) -> Vec<(String, PathBuf)> {
    let mut paths: Vec<(String, PathBuf)> = Vec::new();

    // Claude Code uses ~/.claude.json cross-platform.
    paths.push(("claude_code".to_string(), home.join(".claude.json")));

    #[cfg(target_os = "macos")]
    {
        paths.push((
            "claude_desktop".to_string(),
            home.join("Library/Application Support/Claude/claude_desktop_config.json"),
        ));
        paths.push(("cursor".to_string(), home.join(".cursor/mcp.json")));
        paths.push((
            "windsurf".to_string(),
            home.join(".codeium/windsurf/mcp_config.json"),
        ));
        paths.push(("cline".to_string(), home.join(".cline/mcp_settings.json")));
    }

    #[cfg(target_os = "linux")]
    {
        paths.push((
            "claude_desktop".to_string(),
            home.join(".config/Claude/claude_desktop_config.json"),
        ));
        paths.push(("cursor".to_string(), home.join(".cursor/mcp.json")));
        paths.push((
            "windsurf".to_string(),
            home.join(".codeium/windsurf/mcp_config.json"),
        ));
        paths.push(("cline".to_string(), home.join(".cline/mcp_settings.json")));
    }

    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        if !appdata.is_empty() {
            paths.push((
                "claude_desktop".to_string(),
                PathBuf::from(&appdata).join("Claude/claude_desktop_config.json"),
            ));
        }
        paths.push(("cursor".to_string(), home.join(".cursor/mcp.json")));
        paths.push((
            "windsurf".to_string(),
            home.join(".codeium/windsurf/mcp_config.json"),
        ));
        paths.push(("cline".to_string(), home.join(".cline/mcp_settings.json")));
    }

    paths
}

// ── parse_mcp_config_json ─────────────────────────────────────────────────────

/// Strict parser: errors when `mcpServers` key is absent.
/// Used by the paste-JSON import UI so users can correct their input.
pub fn parse_mcp_config_json(json: &str) -> Result<Vec<McpServerInstallInput>, AppError> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::Validation(format!("invalid JSON: {e}")))?;
    if value.get("mcpServers").is_none() {
        return Err(AppError::Validation(
            "JSON must have a 'mcpServers' object at the top level".to_string(),
        ));
    }
    parse_mcp_servers_from_value(&value)
}

/// Lenient parser: returns an empty vec when `mcpServers` key is absent.
/// Used by auto-detect so config files that only contain preferences are
/// silently skipped rather than logged as errors.
fn parse_mcp_config_json_lenient(json: &str) -> Result<Vec<McpServerInstallInput>, AppError> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::Validation(format!("invalid JSON: {e}")))?;
    parse_mcp_servers_from_value(&value)
}

/// Shared: parses the `mcpServers` map from an already-decoded JSON value.
/// Returns `Ok(vec![])` when the key is absent; errors on malformed entries.
fn parse_mcp_servers_from_value(
    value: &serde_json::Value,
) -> Result<Vec<McpServerInstallInput>, AppError> {
    let Some(servers_map) = value.get("mcpServers").and_then(|v| v.as_object()) else {
        return Ok(vec![]);
    };

    let mut result = Vec::new();

    for (name, entry) in servers_map {
        let obj = entry
            .as_object()
            .ok_or_else(|| AppError::Validation(format!("mcpServers.{name} must be an object")))?;

        let transport = if let Some(url) = obj.get("url").and_then(|v| v.as_str()) {
            // HTTP variant
            let headers: BTreeMap<String, String> = obj
                .get("headers")
                .and_then(|v| v.as_object())
                .map(|m| {
                    m.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            McpTransportSpec::Http {
                url: url.to_string(),
                headers,
            }
        } else if let Some(command) = obj.get("command").and_then(|v| v.as_str()) {
            // Stdio variant
            let args: Vec<String> = obj
                .get("args")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let env: BTreeMap<String, String> = obj
                .get("env")
                .and_then(|v| v.as_object())
                .map(|m| {
                    m.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            let cwd = obj
                .get("cwd")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            McpTransportSpec::Stdio {
                command: command.to_string(),
                args,
                env,
                cwd,
            }
        } else {
            return Err(AppError::Validation(format!(
                "mcpServers.{name} must have either 'command' (stdio) or 'url' (http)"
            )));
        };

        result.push(McpServerInstallInput {
            id: name.clone(),
            display_name: name.clone(),
            description: None,
            transport,
        });
    }

    Ok(result)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn input_to_row(input: &McpServerInstallInput, enabled: bool, now: i64) -> McpServerRow {
    match &input.transport {
        McpTransportSpec::Stdio {
            command,
            args,
            env,
            cwd: _,
        } => McpServerRow {
            id: input.id.clone(),
            display_name: input.display_name.clone(),
            description: input.description.clone(),
            transport_kind: "stdio".to_string(),
            command: Some(command.clone()),
            args_json: serde_json::to_string(args).unwrap_or_else(|_| "[]".to_string()),
            env_json: serde_json::to_string(env).unwrap_or_else(|_| "{}".to_string()),
            url: None,
            headers_json: "{}".to_string(),
            enabled,
            created_at: now,
            updated_at: now,
        },
        McpTransportSpec::Http { url, headers } => McpServerRow {
            id: input.id.clone(),
            display_name: input.display_name.clone(),
            description: input.description.clone(),
            transport_kind: "http".to_string(),
            command: None,
            args_json: "[]".to_string(),
            env_json: "{}".to_string(),
            url: Some(url.clone()),
            headers_json: serde_json::to_string(headers).unwrap_or_else(|_| "{}".to_string()),
            enabled,
            created_at: now,
            updated_at: now,
        },
    }
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── Helper: build McpServerInstallInput from a stored row ────────────────────

/// Reconstruct the transport spec from a stored `McpServerRow`.
pub(crate) fn transport_from_row(row: &McpServerRow) -> Result<McpTransportSpec, AppError> {
    match row.transport_kind.as_str() {
        "stdio" => {
            let command = row.command.clone().ok_or_else(|| {
                AppError::Database(format!(
                    "mcp_servers row '{}' has transport_kind=stdio but missing command",
                    row.id
                ))
            })?;
            let args: Vec<String> = serde_json::from_str(&row.args_json).unwrap_or_default();
            let env: BTreeMap<String, String> =
                serde_json::from_str(&row.env_json).unwrap_or_default();
            Ok(McpTransportSpec::Stdio {
                command,
                args,
                env,
                cwd: None,
            })
        }
        "http" => {
            let url = row.url.clone().ok_or_else(|| {
                AppError::Database(format!(
                    "mcp_servers row '{}' has transport_kind=http but missing url",
                    row.id
                ))
            })?;
            let headers: BTreeMap<String, String> =
                serde_json::from_str(&row.headers_json).unwrap_or_default();
            Ok(McpTransportSpec::Http { url, headers })
        }
        other => Err(AppError::Database(format!(
            "mcp_servers row '{}' has unknown transport_kind '{}'",
            row.id, other
        ))),
    }
}

/// Build McpServerSummary from a stored row and a live status + tool count.
pub(crate) fn summary_from_row(
    row: &McpServerRow,
    status: McpServerStatus,
    tools_count: u32,
) -> McpServerSummary {
    McpServerSummary {
        id: row.id.clone(),
        display_name: row.display_name.clone(),
        description: row.description.clone(),
        transport_kind: row.transport_kind.clone(),
        enabled: row.enabled,
        status,
        tools_count,
    }
}

/// List all stored MCP servers with live status from the supervisor.
pub async fn list_servers_with_status(
    supervisor: &McpSupervisor,
    store: &DataStore,
) -> Result<Vec<McpServerSummary>, AppError> {
    let rows = {
        let conn = store.conn()?;
        list_servers(&conn)?
    };

    let mut summaries = Vec::with_capacity(rows.len());
    for row in &rows {
        let status = if row.enabled {
            supervisor
                .status(&row.id)
                .await
                .unwrap_or(McpServerStatus::Starting)
        } else {
            McpServerStatus::Disabled
        };
        let tools_count = if row.enabled {
            supervisor
                .list_tools(&row.id)
                .await
                .map(|t| t.len() as u32)
                .unwrap_or(0)
        } else {
            0
        };
        summaries.push(summary_from_row(row, status, tools_count));
    }

    Ok(summaries)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_runtime_wire_shape_uses_camel_case_size_bytes_field() {
        // Regression guard: `#[serde(untagged, rename_all = "camelCase")]`
        // on the enum does NOT cascade into a struct variant's field names
        // (confirmed empirically — this bug shipped `size_bytes` over the
        // wire, which the TS `McpRuntimeConsentNeeded.sizeBytes` field
        // never matched, producing `undefined` → "NaN KB" in the consent
        // dialog). Each field needs its own explicit `#[serde(rename)]`.
        let response = McpInstallOutcomeResponse::from(InstallOutcome::NeedsRuntime {
            name: "bun".to_string(),
            size_bytes: 62_914_560,
        });
        let value: serde_json::Value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["sizeBytes"], 62_914_560);
        assert!(
            value.get("size_bytes").is_none(),
            "must not also serialize the raw snake_case field name"
        );
    }
    use crate::mcp::transport::{duplex_pair, Transport, TransportFactory};
    use crate::mcp::types::McpClientError;
    use crate::mcp::{McpSupervisor, SupervisorConfig};
    use async_trait::async_trait;
    use std::collections::BTreeMap;
    use std::sync::Arc;
    use std::time::Duration;

    // ── Minimal mock transport factory reused from supervisor tests ────────────

    struct MockSucceedFactory {
        tool_name: String,
    }

    impl MockSucceedFactory {
        fn new(tool_name: &str) -> Arc<Self> {
            Arc::new(Self {
                tool_name: tool_name.to_string(),
            })
        }
    }

    #[async_trait]
    impl TransportFactory for MockSucceedFactory {
        async fn connect(
            &self,
            _spec: &McpTransportSpec,
        ) -> Result<Box<dyn Transport>, McpClientError> {
            let (transport, mut server) = duplex_pair();
            let tool_name = self.tool_name.clone();
            tokio::spawn(async move {
                // initialize
                let _req = server.recv_line().await;
                server
                    .send_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"mock","version":"0"}}}"#)
                    .await;
                let _ = server.recv_line().await; // notifications/initialized
                                                  // list_tools
                let _list = server.recv_line().await;
                let tools_resp = format!(
                    r#"{{"jsonrpc":"2.0","id":2,"result":{{"tools":[{{"name":"{}","description":"test","inputSchema":{{"type":"object"}}}}]}}}}"#,
                    tool_name
                );
                server.send_line(&tools_resp).await;
                // keep alive
                loop {
                    if server.recv_line().await.is_none() {
                        break;
                    }
                }
            });
            Ok(transport)
        }
    }

    fn make_stdio_input(id: &str) -> McpServerInstallInput {
        McpServerInstallInput {
            id: id.to_string(),
            display_name: format!("Server {id}"),
            description: None,
            transport: McpTransportSpec::Stdio {
                command: "/usr/bin/mcp-server".to_string(),
                args: vec![],
                env: BTreeMap::new(),
                cwd: None,
            },
        }
    }

    // ── 1. parse_mcp_config_json_handles_claude_desktop_shape ────────────────

    #[test]
    fn parse_mcp_config_json_handles_claude_desktop_shape() {
        let json = r#"{
            "mcpServers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                    "env": {"DEBUG": "1"}
                },
                "brave-search": {
                    "command": "/usr/local/bin/brave-mcp",
                    "args": ["--api-key", "sk-xxx"],
                    "env": {}
                }
            }
        }"#;

        let result = parse_mcp_config_json(json).expect("parse failed");
        assert_eq!(result.len(), 2);

        let fs = result
            .iter()
            .find(|s| s.id == "filesystem")
            .expect("filesystem missing");
        match &fs.transport {
            McpTransportSpec::Stdio {
                command, args, env, ..
            } => {
                assert_eq!(command, "npx");
                assert_eq!(
                    args,
                    &["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
                );
                assert_eq!(env.get("DEBUG").map(|s| s.as_str()), Some("1"));
            }
            _ => panic!("expected Stdio"),
        }

        let brave = result
            .iter()
            .find(|s| s.id == "brave-search")
            .expect("brave-search missing");
        match &brave.transport {
            McpTransportSpec::Stdio { command, args, .. } => {
                assert_eq!(command, "/usr/local/bin/brave-mcp");
                assert_eq!(args, &["--api-key", "sk-xxx"]);
            }
            _ => panic!("expected Stdio"),
        }
    }

    // ── 2. parse_mcp_config_json_rejects_missing_command_for_stdio ───────────

    #[test]
    fn parse_mcp_config_json_rejects_missing_command_for_stdio() {
        let json = r#"{
            "mcpServers": {
                "bad-server": {
                    "args": ["--something"]
                }
            }
        }"#;
        // Server has neither "command" nor "url" → validation error
        let result = parse_mcp_config_json(json);
        assert!(
            result.is_err(),
            "expected an error for a server entry with no 'command' or 'url', got: {:?}",
            result
        );
    }

    // ── 3. parse_mcp_config_json_handles_url_shape_for_http ──────────────────

    #[test]
    fn parse_mcp_config_json_handles_url_shape_for_http() {
        let json = r#"{
            "mcpServers": {
                "remote-tools": {
                    "url": "https://api.example.com/mcp",
                    "headers": {"Authorization": "Bearer tok"}
                }
            }
        }"#;

        let result = parse_mcp_config_json(json).expect("parse failed");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "remote-tools");
        match &result[0].transport {
            McpTransportSpec::Http { url, headers } => {
                assert_eq!(url, "https://api.example.com/mcp");
                assert_eq!(
                    headers.get("Authorization").map(|s| s.as_str()),
                    Some("Bearer tok")
                );
            }
            _ => panic!("expected Http"),
        }
    }

    // ── 4. install_server_persists_then_supervises_then_registers_tools ───────

    #[tokio::test]
    async fn install_server_persists_then_supervises_then_registers_tools() {
        let factory = MockSucceedFactory::new("probe_tool");
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory.clone(), cfg);
        let store = crate::storage::create_test_store();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());

        let input = make_stdio_input("test-server");
        let summary = install_server(&supervisor, &registry, &store, input)
            .await
            .expect("install_server failed");

        // Summary fields
        assert_eq!(summary.id, "test-server");
        assert_eq!(summary.transport_kind, "stdio");
        assert!(summary.enabled);
        assert_eq!(summary.tools_count, 1);

        // SQLite row exists
        {
            let conn = store.conn().unwrap();
            let row = crate::storage::mcp_servers::get_server(&conn, "test-server")
                .unwrap()
                .expect("row not found in SQLite");
            assert!(row.enabled);
        }

        // Tool registry has the tool
        let all_tools = registry.list_all();
        let mcp_tools: Vec<_> = all_tools
            .iter()
            .filter(|t| matches!(&t.source, crate::agents::tools::ToolSource::Mcp(_)))
            .collect();
        assert_eq!(mcp_tools.len(), 1);
        assert_eq!(mcp_tools[0].id, "probe_tool");
    }

    // ── 5. detect_existing_configs_returns_empty_when_no_files_present ────────

    #[tokio::test]
    async fn detect_existing_configs_returns_empty_when_no_files_present() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let result = detect_existing_configs_with_home(Some(tmp.path())).await;
        assert!(
            result.is_empty(),
            "expected empty Vec when home dir has no config files, got {} entries",
            result.len()
        );
    }

    // ── 6. parse_mcp_config_json_lenient_returns_empty_when_no_mcp_servers_key

    #[test]
    fn parse_mcp_config_json_lenient_returns_empty_when_no_mcp_servers_key() {
        let json = r#"{"preferences":{"theme":"dark"}}"#;
        let result = parse_mcp_config_json_lenient(json).expect("lenient parse failed");
        assert!(
            result.is_empty(),
            "expected empty vec for JSON with no mcpServers key, got: {result:?}"
        );
    }

    // ── 7. detect_existing_configs_includes_claude_code_path ──────────────────

    #[tokio::test]
    async fn detect_existing_configs_includes_claude_code_path() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let claude_json = tmp.path().join(".claude.json");
        std::fs::write(
            &claude_json,
            r#"{"mcpServers":{"context7":{"url":"https://mcp.context7.com"}}}"#,
        )
        .expect("write .claude.json");

        let result = detect_existing_configs_with_home(Some(tmp.path())).await;

        let found = result.iter().find(|c| c.source == "claude_code");
        assert!(
            found.is_some(),
            "expected a DetectedConfig with source 'claude_code', got: {result:?}"
        );
        let cfg = found.unwrap();
        assert_eq!(
            cfg.servers.len(),
            1,
            "expected 1 server in claude_code config"
        );
        assert_eq!(cfg.servers[0].id, "context7");
    }

    // ── 8. detect_existing_configs_skips_files_without_mcp_servers_key ────────

    #[tokio::test]
    async fn detect_existing_configs_skips_files_without_mcp_servers_key() {
        let tmp = tempfile::tempdir().expect("tempdir");
        // Write a preferences-only file at the claude_code path
        let claude_json = tmp.path().join(".claude.json");
        std::fs::write(&claude_json, r#"{"preferences":{"theme":"light"}}"#)
            .expect("write .claude.json");

        let result = detect_existing_configs_with_home(Some(tmp.path())).await;

        assert!(
            result.is_empty(),
            "expected empty results when config files have no mcpServers key, got: {result:?}"
        );
    }

    // ── RED: install_server surfaces a "needs runtime" outcome instead of a
    // hard AppError when a stdio server needs bun/uv and it isn't installed
    // ──────────────────────────────────────────────────────────────────────
    //
    // `RuntimeAvailability`, `InstallOutcome`, and
    // `install_server_checking_runtime` don't exist yet — production code
    // must add them. The crate fails to compile until then; that is the
    // expected RED state for this test.

    struct AlwaysMissingBun;

    impl super::RuntimeAvailability for AlwaysMissingBun {
        fn needs_download(&self, name: &str) -> Option<u64> {
            match name {
                "bun" => Some(42_000_000),
                _ => None,
            }
        }
    }

    #[tokio::test]
    async fn install_server_checking_runtime_returns_needs_runtime_when_bun_is_not_installed() {
        let factory = MockSucceedFactory::new("probe_tool");
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let store = crate::storage::create_test_store();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());

        let input = McpServerInstallInput {
            id: "npx-server".to_string(),
            display_name: "NPX Server".to_string(),
            description: None,
            transport: McpTransportSpec::Stdio {
                command: "npx".to_string(),
                args: vec!["-y".to_string(), "some-mcp-server".to_string()],
                env: BTreeMap::new(),
                cwd: None,
            },
        };

        // `|_| false`: explicitly "not found on PATH" so this test is
        // deterministic regardless of whether the machine running it happens
        // to have a real `npx` on PATH (fix #3).
        let runtime_manager = crate::runtimes::RuntimeManager::new();
        let outcome = super::install_server_checking_runtime(
            &supervisor,
            &registry,
            &store,
            input,
            &AlwaysMissingBun,
            |_| false,
            &runtime_manager,
        )
        .await
        .expect("a missing runtime must produce a success-shaped outcome, not a hard AppError");

        match outcome {
            super::InstallOutcome::NeedsRuntime { name, size_bytes } => {
                assert_eq!(name, "bun");
                assert_eq!(size_bytes, 42_000_000);
            }
            other => panic!("expected NeedsRuntime outcome, got: {other:?}"),
        }

        // Must short-circuit before persisting a half-installed server.
        let conn = store.conn().unwrap();
        assert!(
            crate::storage::mcp_servers::get_server(&conn, "npx-server")
                .unwrap()
                .is_none(),
            "server must not be persisted while the required runtime is still missing"
        );
    }

    // ── RED (fix #3): install/enable-time runtime check must consult the
    // system PATH first, same as the actual spawn-time resolution — a
    // command already on PATH needs no bundled runtime at all.

    #[tokio::test]
    async fn install_server_checking_runtime_skips_runtime_check_when_command_found_on_path() {
        let factory = MockSucceedFactory::new("probe_tool");
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let store = crate::storage::create_test_store();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());

        let input = McpServerInstallInput {
            id: "npx-on-path-server".to_string(),
            display_name: "NPX On PATH Server".to_string(),
            description: None,
            transport: McpTransportSpec::Stdio {
                command: "npx".to_string(),
                args: vec!["-y".to_string(), "some-mcp-server".to_string()],
                env: BTreeMap::new(),
                cwd: None,
            },
        };

        // Probe reports npx present on PATH — the bun requirement must never
        // even be consulted, so `AlwaysMissingBun` must not cause NeedsRuntime.
        let runtime_manager = crate::runtimes::RuntimeManager::new();
        let outcome = super::install_server_checking_runtime(
            &supervisor,
            &registry,
            &store,
            input,
            &AlwaysMissingBun,
            |_| true,
            &runtime_manager,
        )
        .await
        .expect("install must succeed when the command is found on PATH");

        match outcome {
            super::InstallOutcome::Installed(summary) => {
                assert_eq!(summary.id, "npx-on-path-server");
                assert_eq!(summary.tools_count, 1);
            }
            other => panic!("expected Installed outcome when found on PATH, got: {other:?}"),
        }
    }

    #[test]
    fn required_runtime_for_command_with_probe_returns_none_for_http_transport_regardless_of_probe()
    {
        let http = McpTransportSpec::Http {
            url: "https://example.com/mcp".to_string(),
            headers: BTreeMap::new(),
        };
        assert_eq!(
            super::required_runtime_for_command_with_probe(&http, |_| false),
            None
        );
        assert_eq!(
            super::required_runtime_for_command_with_probe(&http, |_| true),
            None
        );
    }

    #[test]
    fn required_runtime_for_command_with_probe_maps_npx_to_bun_when_not_on_path() {
        let stdio = McpTransportSpec::Stdio {
            command: "npx".to_string(),
            args: vec![],
            env: BTreeMap::new(),
            cwd: None,
        };
        assert_eq!(
            super::required_runtime_for_command_with_probe(&stdio, |_| false),
            Some("bun")
        );
        assert_eq!(
            super::required_runtime_for_command_with_probe(&stdio, |_| true),
            None
        );
    }

    // ── RED: install must register "mcp:<server_id>" as a runtime consumer
    // on success, so Settings' "remove runtime" warning knows this server
    // depends on it. Exercised through `install_server_checking_runtime`
    // itself (not the `_ensuring` wrapper): that function is AppHandle-free
    // already — the only place this crate can add the consumer-registration
    // check while staying unit-testable, since `_ensuring` takes a concrete
    // `&tauri::AppHandle` that `tauri::test::mock_app()` cannot produce
    // (it's parameterized by `MockRuntime`, not `Wry`).

    struct AlwaysInstalled;

    impl super::RuntimeAvailability for AlwaysInstalled {
        fn needs_download(&self, _name: &str) -> Option<u64> {
            None
        }
    }

    #[tokio::test]
    async fn install_server_checking_runtime_registers_mcp_consumer_on_success() {
        let factory = MockSucceedFactory::new("probe_tool");
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let store = crate::storage::create_test_store();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let runtime_manager = crate::runtimes::RuntimeManager::new();

        let input = McpServerInstallInput {
            id: "npx-server".to_string(),
            display_name: "NPX Server".to_string(),
            description: None,
            transport: McpTransportSpec::Stdio {
                command: "npx".to_string(),
                args: vec![],
                env: BTreeMap::new(),
                cwd: None,
            },
        };

        let outcome = super::install_server_checking_runtime(
            &supervisor,
            &registry,
            &store,
            input,
            &AlwaysInstalled,
            |_| false,
            &runtime_manager,
        )
        .await
        .expect("install must succeed once bun is reported already installed");

        assert!(matches!(outcome, super::InstallOutcome::Installed(_)));
        assert_eq!(
            runtime_manager.consumers_of("bun"),
            vec!["mcp:npx-server".to_string()],
            "install must register the server as a bun consumer"
        );
    }

    #[tokio::test]
    async fn install_server_checking_runtime_does_not_register_consumer_for_http_transport() {
        let factory = MockSucceedFactory::new("probe_tool");
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let store = crate::storage::create_test_store();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let runtime_manager = crate::runtimes::RuntimeManager::new();

        let input = McpServerInstallInput {
            id: "http-server".to_string(),
            display_name: "HTTP Server".to_string(),
            description: None,
            transport: McpTransportSpec::Http {
                url: "https://example.com/mcp".to_string(),
                headers: BTreeMap::new(),
            },
        };

        let outcome = super::install_server_checking_runtime(
            &supervisor,
            &registry,
            &store,
            input,
            &AlwaysInstalled,
            |_| false,
            &runtime_manager,
        )
        .await
        .expect("http install must succeed without any runtime");

        assert!(matches!(outcome, super::InstallOutcome::Installed(_)));
        assert!(
            runtime_manager.consumers_of("bun").is_empty(),
            "http transport never needs bun, so it must not register a consumer"
        );
    }

    #[tokio::test]
    async fn install_server_checking_runtime_does_not_register_consumer_when_command_found_on_path()
    {
        let factory = MockSucceedFactory::new("probe_tool");
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let store = crate::storage::create_test_store();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let runtime_manager = crate::runtimes::RuntimeManager::new();

        let input = make_stdio_input("on-path-server");

        let outcome = super::install_server_checking_runtime(
            &supervisor,
            &registry,
            &store,
            input,
            &AlwaysInstalled,
            |_| true,
            &runtime_manager,
        )
        .await
        .expect("install must succeed when the command is found on PATH");

        assert!(matches!(outcome, super::InstallOutcome::Installed(_)));
        assert!(
            runtime_manager.consumers_of("bun").is_empty(),
            "a command already on PATH needs no bundled runtime, so no consumer must be registered"
        );
    }
}
