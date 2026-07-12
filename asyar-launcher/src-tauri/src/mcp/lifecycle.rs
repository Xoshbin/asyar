use crate::agents::tools::ToolRegistryState;
use crate::error::AppError;
use crate::mcp::install::{
    required_runtime_for_command_with_probe, transport_from_row, RuntimeAvailability,
    SingleRuntimeAvailability,
};
use crate::mcp::supervisor::McpSupervisor;
use crate::mcp::tool_adapter::descriptors_from_mcp_tools;
use crate::mcp::types::McpServerConfig;
use crate::storage::mcp_audit;
use crate::storage::mcp_permissions;
use crate::storage::mcp_servers;
use crate::storage::mcp_servers::McpServerRow;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;

/// Timeout used by `enable_and_wait_for_tools` in startup seed and enable-toggle flows.
const ENABLE_WAIT_TIMEOUT: Duration = Duration::from_secs(10);

// ── mcp_seed_enabled_servers_at_startup ───────────────────────────────────────

/// Testable core of the startup seed loop. `path_probe` and `runtime_installed`
/// are injectable (fix #2/#3) so tests don't depend on the ambient system
/// PATH or a real `RuntimeManager`: `path_probe` answers "is this system
/// command on PATH", `runtime_installed` answers "is this bundled runtime
/// (bun/uv) already downloaded" — both cheap, local, no-network checks.
///
/// A server whose command needs a bundled runtime that isn't installed skips
/// the handshake attempt entirely (rather than attempting-and-failing it,
/// which previously bypassed the runtime-consent check and produced the same
/// generic warn as any other handshake failure — fix #2).
async fn seed_enabled_servers(
    supervisor: &McpSupervisor,
    registry: &ToolRegistryState,
    store: &crate::storage::DataStore,
    path_probe: impl Fn(&str) -> bool,
    runtime_installed: impl Fn(&str) -> bool,
) {
    let rows: Vec<McpServerRow> = {
        let conn = match store.conn() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[mcp seed] failed to acquire DB connection: {e}");
                return;
            }
        };
        match mcp_servers::list_servers(&conn) {
            Ok(r) => r,
            Err(e) => {
                log::warn!("[mcp seed] failed to list servers: {e}");
                return;
            }
        }
    };

    let enabled: Vec<_> = rows.into_iter().filter(|r| r.enabled).collect();
    if enabled.is_empty() {
        return;
    }

    log::info!("[mcp seed] seeding {} enabled MCP server(s)", enabled.len());

    for row in enabled {
        let transport = match transport_from_row(&row) {
            Ok(t) => t,
            Err(e) => {
                log::warn!("[mcp seed] skipping '{}': {e}", row.id);
                continue;
            }
        };

        if let Some(name) = required_runtime_for_command_with_probe(&transport, &path_probe) {
            if !runtime_installed(name) {
                log::warn!(
                    "[mcp seed] '{}' needs runtime '{}' which is not installed yet — skipping handshake until it's installed via Settings",
                    row.id,
                    name
                );
                continue;
            }
        }

        let config = McpServerConfig {
            id: row.id.clone(),
            display_name: row.display_name.clone(),
            transport,
            enabled: true,
        };

        // Enable the watchdog and wait for the first handshake to complete so
        // tools are available immediately. A single handshake is performed by
        // the watchdog — no separate connect_and_list_tools call is needed.
        let tools = match supervisor
            .enable_and_wait_for_tools(config, ENABLE_WAIT_TIMEOUT)
            .await
        {
            Ok(t) => t,
            Err(e) => {
                log::warn!("[mcp seed] handshake failed for '{}': {e}", row.id);
                continue;
            }
        };

        let manifest_tools = descriptors_from_mcp_tools(&row.id, tools);
        if let Err(e) = registry.register_mcp(&row.id, manifest_tools) {
            log::warn!("[mcp seed] failed to register tools for '{}': {e}", row.id);
        }
    }
}

/// Called once during `setup_app`, after the supervisor and tool registry are
/// managed. Reads all enabled MCP servers from SQLite, probes each one for its
/// tool list, registers the tools in the tool registry, then starts the
/// supervisor watchdog for each — skipping any server whose command needs a
/// bundled runtime that isn't installed yet (fix #2). Concrete (not generic
/// over `R: tauri::Runtime`) because its only caller (`setup_app`) always has
/// a concrete `AppHandle`, and `RuntimeManager::resolve` itself is concrete —
/// see `runtimes::RuntimeManager`.
pub async fn mcp_seed_enabled_servers_at_startup(app: &tauri::AppHandle) {
    let supervisor = match app.try_state::<Arc<McpSupervisor>>() {
        Some(s) => Arc::clone(&*s),
        None => {
            log::warn!("[mcp seed] McpSupervisor not managed — skipping seed");
            return;
        }
    };
    let registry = match app.try_state::<ToolRegistryState>() {
        Some(r) => Arc::clone(&*r),
        None => {
            log::warn!("[mcp seed] ToolRegistry not managed — skipping seed");
            return;
        }
    };
    let store = match app.try_state::<crate::storage::DataStore>() {
        Some(s) => s,
        None => {
            log::warn!("[mcp seed] DataStore not managed — skipping seed");
            return;
        }
    };
    let runtime_manager = app.try_state::<crate::runtimes::RuntimeManager>();

    seed_enabled_servers(
        &supervisor,
        &registry,
        &store,
        crate::mcp::sidecar::system_command_exists,
        |name| {
            runtime_manager
                .as_deref()
                .is_some_and(|rm| rm.resolve(app, name).is_some())
        },
    )
    .await;
}

// ── mcp_sync_on_enable_change ─────────────────────────────────────────────────

/// Called when the user flips the enabled toggle for an MCP server.
///
/// - `enabled = true` → probe for tools, register, start watchdog, update DB.
/// - `enabled = false` → stop watchdog, unregister tools, update DB.
pub async fn mcp_sync_on_enable_change<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    server_id: &str,
    enabled: bool,
) -> Result<(), AppError> {
    let supervisor = app
        .try_state::<Arc<McpSupervisor>>()
        .map(|s| Arc::clone(&*s))
        .ok_or_else(|| AppError::Other("McpSupervisor not managed".to_string()))?;
    let registry = app
        .try_state::<ToolRegistryState>()
        .map(|s| Arc::clone(&*s))
        .ok_or_else(|| AppError::Other("ToolRegistry not managed".to_string()))?;
    let store = app
        .try_state::<crate::storage::DataStore>()
        .ok_or_else(|| AppError::Other("DataStore not managed".to_string()))?;

    if enabled {
        // Load the row.
        let row = {
            let conn = store.conn()?;
            mcp_servers::get_server(&conn, server_id)?.ok_or_else(|| {
                AppError::NotFound(format!("MCP server '{}' not found", server_id))
            })?
        };

        let transport = transport_from_row(&row)?;

        let config = McpServerConfig {
            id: row.id.clone(),
            display_name: row.display_name.clone(),
            transport,
            enabled: true,
        };

        // Enable watchdog and wait for the first handshake — one round-trip.
        let tools = supervisor
            .enable_and_wait_for_tools(config, ENABLE_WAIT_TIMEOUT)
            .await
            .map_err(|e| {
                AppError::Other(format!(
                    "MCP server '{}' handshake failed: {}",
                    server_id, e
                ))
            })?;

        let manifest_tools = descriptors_from_mcp_tools(server_id, tools);
        registry.register_mcp(server_id, manifest_tools)?;

        // Persist enabled=true.
        let conn = store.conn()?;
        mcp_servers::set_enabled(&conn, server_id, true)?;
    } else {
        // Stop watchdog.
        supervisor
            .disable(&server_id.to_string())
            .await
            .map_err(|e| {
                AppError::Other(format!(
                    "Failed to disable supervisor for '{}': {}",
                    server_id, e
                ))
            })?;

        // Unregister tools.
        registry.unregister_mcp(server_id)?;

        // Persist enabled=false.
        let conn = store.conn()?;
        mcp_servers::set_enabled(&conn, server_id, false)?;
    }

    Ok(())
}

// ── mcp_sync_on_enable_change_checking_runtime ────────────────────────────────

/// Outcome of enabling a server through the runtime-aware path: either the
/// enable actually went through, or a required bundled runtime (bun/uv)
/// isn't installed yet and the caller must drive a consent+download flow
/// before retrying.
#[derive(Debug, Clone, PartialEq)]
pub enum EnableOutcome {
    Applied,
    NeedsRuntime { name: String, size_bytes: u64 },
}

/// Like `mcp_sync_on_enable_change`, but when `enabled` is true first checks
/// whether the server's stored transport needs a bundled runtime that isn't
/// installed yet, returning `NeedsRuntime` instead of letting the handshake
/// fail with an error the user can't act on. Disabling never needs a
/// runtime, so it always delegates straight through. `path_probe` is
/// injectable (fix #3) so tests don't depend on the ambient system PATH.
pub async fn mcp_sync_on_enable_change_checking_runtime<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    server_id: &str,
    enabled: bool,
    runtime_availability: &dyn RuntimeAvailability,
    path_probe: impl Fn(&str) -> bool,
) -> Result<EnableOutcome, AppError> {
    if enabled {
        let store = app
            .try_state::<crate::storage::DataStore>()
            .ok_or_else(|| AppError::Other("DataStore not managed".to_string()))?;
        let row = {
            let conn = store.conn()?;
            mcp_servers::get_server(&conn, server_id)?.ok_or_else(|| {
                AppError::NotFound(format!("MCP server '{}' not found", server_id))
            })?
        };
        let transport = transport_from_row(&row)?;
        if let Some(name) = required_runtime_for_command_with_probe(&transport, path_probe) {
            if let Some(size_bytes) = runtime_availability.needs_download(name) {
                return Ok(EnableOutcome::NeedsRuntime {
                    name: name.to_string(),
                    size_bytes,
                });
            }
        }
    }

    mcp_sync_on_enable_change(app, server_id, enabled).await?;
    Ok(EnableOutcome::Applied)
}

/// Production entry point for the `mcp_set_server_enabled` command:
/// determines whether the server's transport needs a bundled runtime
/// (PATH-aware, fix #3) and, only when `enabled` is true and a runtime is
/// actually needed, makes a single network `ensure()` call for that one
/// runtime (fix #4) before delegating to
/// `mcp_sync_on_enable_change_checking_runtime`. Disabling (and any
/// transport that needs no runtime) makes zero network calls. Business
/// logic lives here (not in `commands/mcp.rs`, fix #9) so the Tauri command
/// itself stays a thin wrapper. Concrete `AppHandle` for the same reason as
/// `mcp_seed_enabled_servers_at_startup` — its only caller is the Tauri
/// command layer, which always has a concrete handle.
pub async fn mcp_sync_on_enable_change_checking_runtime_ensuring(
    app: &tauri::AppHandle,
    runtime_manager: &crate::runtimes::RuntimeManager,
    server_id: &str,
    enabled: bool,
) -> Result<EnableOutcome, AppError> {
    let probe = crate::mcp::sidecar::system_command_exists;

    let availability = if !enabled {
        // Disabling never needs a runtime — skip the check (and any network
        // call) entirely.
        SingleRuntimeAvailability::none()
    } else {
        let store = app
            .try_state::<crate::storage::DataStore>()
            .ok_or_else(|| AppError::Other("DataStore not managed".to_string()))?;
        let row = {
            let conn = store.conn()?;
            mcp_servers::get_server(&conn, server_id)?.ok_or_else(|| {
                AppError::NotFound(format!("MCP server '{}' not found", server_id))
            })?
        };
        let transport = transport_from_row(&row)?;
        match required_runtime_for_command_with_probe(&transport, probe) {
            None => SingleRuntimeAvailability::none(),
            Some(name) => {
                let result = runtime_manager.ensure(app, name).await?;
                SingleRuntimeAvailability::from_ensure(name, result)
            }
        }
    };

    mcp_sync_on_enable_change_checking_runtime(app, server_id, enabled, &availability, probe).await
}

/// Wire shape for `mcp_set_server_enabled`'s response (fix #9: lives next to
/// `EnableOutcome`, not in `commands/mcp.rs`). `#[serde(untagged)]` means
/// the normal-success case serializes as a bare `true`, while the
/// needs-runtime case carries an explicit `kind: "needsRuntime"`.
#[derive(Debug, Serialize)]
#[serde(untagged, rename_all = "camelCase")]
pub enum McpSetEnabledOutcomeResponse {
    NeedsRuntime {
        kind: &'static str,
        name: String,
        size_bytes: u64,
    },
    Applied(bool),
}

impl From<EnableOutcome> for McpSetEnabledOutcomeResponse {
    fn from(outcome: EnableOutcome) -> Self {
        match outcome {
            EnableOutcome::Applied => McpSetEnabledOutcomeResponse::Applied(true),
            EnableOutcome::NeedsRuntime { name, size_bytes } => {
                McpSetEnabledOutcomeResponse::NeedsRuntime {
                    kind: "needsRuntime",
                    name,
                    size_bytes,
                }
            }
        }
    }
}

// ── mcp_cleanup_on_delete ─────────────────────────────────────────────────────

/// Called when the user deletes an MCP server. Stops the watchdog, removes all
/// registered tools, and deletes the persisted rows (server, audit, permissions).
pub async fn mcp_cleanup_on_delete<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    server_id: &str,
) -> Result<(), AppError> {
    let supervisor = app
        .try_state::<Arc<McpSupervisor>>()
        .map(|s| Arc::clone(&*s))
        .ok_or_else(|| AppError::Other("McpSupervisor not managed".to_string()))?;
    let registry = app
        .try_state::<ToolRegistryState>()
        .map(|s| Arc::clone(&*s))
        .ok_or_else(|| AppError::Other("ToolRegistry not managed".to_string()))?;
    let store = app
        .try_state::<crate::storage::DataStore>()
        .ok_or_else(|| AppError::Other("DataStore not managed".to_string()))?;

    // Stop watchdog (idempotent if not running).
    supervisor
        .disable(&server_id.to_string())
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Failed to disable supervisor for '{}': {}",
                server_id, e
            ))
        })?;

    // Unregister tools (no-op if not registered).
    registry.unregister_mcp(server_id)?;

    // Delete persisted data.
    {
        let conn = store.conn()?;
        mcp_servers::delete_server(&conn, server_id)?;
        mcp_audit::purge_for_server(&conn, server_id)?;
        mcp_permissions::delete_for_server(&conn, server_id)?;
    }

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::transport::{duplex_pair, Transport, TransportFactory};
    use crate::mcp::types::{McpClientError, McpTransportSpec};
    use crate::mcp::{McpSupervisor, SupervisorConfig};
    use async_trait::async_trait;

    use std::sync::Arc;
    use std::time::Duration;

    struct MockSucceedFactory;

    #[async_trait]
    impl TransportFactory for MockSucceedFactory {
        async fn connect(
            &self,
            _spec: &McpTransportSpec,
        ) -> Result<Box<dyn Transport>, McpClientError> {
            let (transport, mut server) = duplex_pair();
            tokio::spawn(async move {
                let _req = server.recv_line().await;
                server
                    .send_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"mock","version":"0"}}}"#)
                    .await;
                let _ = server.recv_line().await;
                let _list = server.recv_line().await;
                server
                    .send_line(r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"lifecycle_tool","description":"a tool","inputSchema":{"type":"object"}}]}}"#)
                    .await;
                loop {
                    if server.recv_line().await.is_none() {
                        break;
                    }
                }
            });
            Ok(transport)
        }
    }

    fn make_supervisor() -> Arc<McpSupervisor> {
        let factory = Arc::new(MockSucceedFactory);
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        Arc::new(McpSupervisor::new(factory, cfg))
    }

    // ── Test-only helpers that avoid AppHandle dependency ────────────────────

    /// Equivalent to `mcp_seed_enabled_servers_at_startup` but called with
    /// direct references (no AppHandle needed in tests).
    async fn seed_servers_directly(
        supervisor: &Arc<McpSupervisor>,
        registry: &Arc<crate::agents::tools::ToolRegistry>,
        store: &crate::storage::DataStore,
    ) {
        let rows = {
            let conn = store.conn().unwrap();
            mcp_servers::list_servers(&conn).unwrap()
        };

        for row in rows.into_iter().filter(|r| r.enabled) {
            let transport = match transport_from_row(&row) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let config = McpServerConfig {
                id: row.id.clone(),
                display_name: row.display_name.clone(),
                transport,
                enabled: true,
            };
            let tools = match supervisor
                .enable_and_wait_for_tools(config, Duration::from_secs(5))
                .await
            {
                Ok(t) => t,
                Err(_) => continue,
            };
            let manifest_tools = descriptors_from_mcp_tools(&row.id, tools);
            let _ = registry.register_mcp(&row.id, manifest_tools);
        }
    }

    async fn sync_enable_change_directly(
        supervisor: &Arc<McpSupervisor>,
        registry: &Arc<crate::agents::tools::ToolRegistry>,
        store: &crate::storage::DataStore,
        server_id: &str,
        enabled: bool,
    ) -> Result<(), AppError> {
        if enabled {
            let row = {
                let conn = store.conn()?;
                mcp_servers::get_server(&conn, server_id)?
                    .ok_or_else(|| AppError::NotFound(format!("server '{server_id}' not found")))?
            };
            let transport = transport_from_row(&row)?;
            let config = McpServerConfig {
                id: row.id.clone(),
                display_name: row.display_name.clone(),
                transport,
                enabled: true,
            };
            let tools = supervisor
                .enable_and_wait_for_tools(config, Duration::from_secs(5))
                .await
                .map_err(|e| AppError::Other(e.to_string()))?;
            let manifest_tools = descriptors_from_mcp_tools(server_id, tools);
            registry.register_mcp(server_id, manifest_tools)?;
            let conn = store.conn()?;
            mcp_servers::set_enabled(&conn, server_id, true)?;
        } else {
            supervisor
                .disable(&server_id.to_string())
                .await
                .map_err(|e| AppError::Other(e.to_string()))?;
            registry.unregister_mcp(server_id)?;
            let conn = store.conn()?;
            mcp_servers::set_enabled(&conn, server_id, false)?;
        }
        Ok(())
    }

    async fn cleanup_delete_directly(
        supervisor: &Arc<McpSupervisor>,
        registry: &Arc<crate::agents::tools::ToolRegistry>,
        store: &crate::storage::DataStore,
        server_id: &str,
    ) -> Result<(), AppError> {
        supervisor
            .disable(&server_id.to_string())
            .await
            .map_err(|e| AppError::Other(e.to_string()))?;
        registry.unregister_mcp(server_id)?;
        let conn = store.conn()?;
        mcp_servers::delete_server(&conn, server_id)?;
        mcp_audit::purge_for_server(&conn, server_id)?;
        mcp_permissions::delete_for_server(&conn, server_id)?;
        Ok(())
    }

    // ── 1. seed_enabled_servers_registers_tools_for_enabled_rows ─────────────

    #[tokio::test]
    async fn seed_enabled_servers_registers_tools_for_enabled_rows() {
        let supervisor = make_supervisor();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let store = crate::storage::create_test_store();

        // Insert an enabled server row into SQLite.
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "seed-srv".to_string(),
                    display_name: "Seed Server".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("/usr/bin/mcp-server".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: true,
                    created_at: 1000,
                    updated_at: 1000,
                },
            )
            .unwrap();
        }

        seed_servers_directly(&supervisor, &registry, &store).await;

        // The tool should be registered.
        let tools = registry.list_all();
        let mcp: Vec<_> = tools
            .iter()
            .filter(|t| matches!(&t.source, crate::agents::tools::ToolSource::Mcp(_)))
            .collect();
        assert_eq!(mcp.len(), 1, "expected 1 MCP tool after seed");
        assert_eq!(mcp[0].id, "lifecycle_tool");
    }

    // ── 2. sync_enable_registers_then_disable_unregisters ────────────────────

    #[tokio::test]
    async fn sync_enable_registers_then_disable_unregisters() {
        let supervisor = make_supervisor();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let store = crate::storage::create_test_store();

        // Insert a disabled server row.
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "toggle-srv".to_string(),
                    display_name: "Toggle Server".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("/usr/bin/mcp-server".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: false,
                    created_at: 2000,
                    updated_at: 2000,
                },
            )
            .unwrap();
        }

        // Enable → tools should appear.
        sync_enable_change_directly(&supervisor, &registry, &store, "toggle-srv", true)
            .await
            .expect("enable failed");

        let tools_after_enable = registry.list_all();
        let mcp: Vec<_> = tools_after_enable
            .iter()
            .filter(|t| matches!(&t.source, crate::agents::tools::ToolSource::Mcp(_)))
            .collect();
        assert_eq!(mcp.len(), 1, "expected 1 MCP tool after enable");

        // DB should reflect enabled=true.
        {
            let conn = store.conn().unwrap();
            let row = crate::storage::mcp_servers::get_server(&conn, "toggle-srv")
                .unwrap()
                .unwrap();
            assert!(row.enabled);
        }

        // Disable → tools should be gone.
        sync_enable_change_directly(&supervisor, &registry, &store, "toggle-srv", false)
            .await
            .expect("disable failed");

        let tools_after_disable = registry.list_all();
        let mcp_after_disable: Vec<_> = tools_after_disable
            .iter()
            .filter(|t| matches!(&t.source, crate::agents::tools::ToolSource::Mcp(_)))
            .collect();
        assert_eq!(
            mcp_after_disable.len(),
            0,
            "expected no MCP tools after disable"
        );

        // DB should reflect enabled=false.
        {
            let conn = store.conn().unwrap();
            let row = crate::storage::mcp_servers::get_server(&conn, "toggle-srv")
                .unwrap()
                .unwrap();
            assert!(!row.enabled);
        }
    }

    // ── 3. cleanup_on_delete_drops_tools_audit_and_permissions ───────────────

    #[tokio::test]
    async fn cleanup_on_delete_drops_tools_audit_and_permissions() {
        let supervisor = make_supervisor();
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let store = crate::storage::create_test_store();

        // Insert a server.
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "delete-srv".to_string(),
                    display_name: "Delete Server".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("/usr/bin/mcp-server".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: true,
                    created_at: 3000,
                    updated_at: 3000,
                },
            )
            .unwrap();

            // Insert audit + permission rows.
            crate::storage::mcp_audit::insert_entry(
                &conn,
                &crate::storage::mcp_audit::NewMcpAuditEntry {
                    server_id: "delete-srv".to_string(),
                    tool_id: "lifecycle_tool".to_string(),
                    agent_id: None,
                    called_at: 3001,
                    success: true,
                    error_summary: None,
                    args_summary: "{}".to_string(),
                },
            )
            .unwrap();

            crate::storage::mcp_permissions::set_permission(
                &conn,
                &crate::storage::mcp_permissions::McpPermissionRow {
                    server_id: "delete-srv".to_string(),
                    tool_id: "lifecycle_tool".to_string(),
                    agent_id: "agent-1".to_string(),
                    decision: crate::storage::mcp_permissions::PermissionDecision::AllowAlways,
                    set_at: 3002,
                },
            )
            .unwrap();
        }

        // Seed tools.
        seed_servers_directly(&supervisor, &registry, &store).await;

        // Delete.
        cleanup_delete_directly(&supervisor, &registry, &store, "delete-srv")
            .await
            .expect("cleanup failed");

        // Server row gone.
        {
            let conn = store.conn().unwrap();
            assert!(
                crate::storage::mcp_servers::get_server(&conn, "delete-srv")
                    .unwrap()
                    .is_none(),
                "server row should be deleted"
            );
            // Audit rows gone.
            let audit =
                crate::storage::mcp_audit::list_recent(&conn, Some("delete-srv"), 10).unwrap();
            assert_eq!(audit.len(), 0, "audit rows should be purged");
            // Permission rows gone.
            let perm = crate::storage::mcp_permissions::get_permission(
                &conn,
                "delete-srv",
                "lifecycle_tool",
                "agent-1",
            )
            .unwrap();
            assert!(perm.is_none(), "permission row should be deleted");
        }

        // Tool registry empty.
        let tools = registry.list_all();
        let mcp: Vec<_> = tools
            .iter()
            .filter(|t| matches!(&t.source, crate::agents::tools::ToolSource::Mcp(_)))
            .collect();
        assert_eq!(mcp.len(), 0, "tool registry should be empty after delete");
    }

    // ── 4. seed_makes_exactly_one_factory_connect_call_per_server ────────────
    //
    // Verifies the L1 fix: startup seed uses enable_and_wait_for_tools which
    // performs exactly one handshake (via the watchdog), not two.

    struct CountingFactory {
        connect_count: Arc<std::sync::Mutex<u32>>,
    }

    impl CountingFactory {
        fn new() -> (Arc<Self>, Arc<std::sync::Mutex<u32>>) {
            let counter = Arc::new(std::sync::Mutex::new(0u32));
            let factory = Arc::new(Self {
                connect_count: Arc::clone(&counter),
            });
            (factory, counter)
        }
    }

    #[async_trait]
    impl TransportFactory for CountingFactory {
        async fn connect(
            &self,
            _spec: &McpTransportSpec,
        ) -> Result<Box<dyn Transport>, McpClientError> {
            *self.connect_count.lock().unwrap() += 1;
            let (transport, mut server) = duplex_pair();
            tokio::spawn(async move {
                let _req = server.recv_line().await;
                server
                    .send_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"mock","version":"0"}}}"#)
                    .await;
                let _ = server.recv_line().await;
                let _list = server.recv_line().await;
                server
                    .send_line(r#"{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"lifecycle_tool","description":"a tool","inputSchema":{"type":"object"}}]}}"#)
                    .await;
                loop {
                    if server.recv_line().await.is_none() {
                        break;
                    }
                }
            });
            Ok(transport)
        }
    }

    #[tokio::test]
    async fn seed_makes_exactly_one_factory_connect_call_per_server() {
        let (factory, counter) = CountingFactory::new();
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = Arc::new(McpSupervisor::new(factory, cfg));
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let store = crate::storage::create_test_store();

        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "count-srv".to_string(),
                    display_name: "Count Server".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("/usr/bin/mcp-server".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: true,
                    created_at: 5000,
                    updated_at: 5000,
                },
            )
            .unwrap();
        }

        seed_servers_directly(&supervisor, &registry, &store).await;

        let call_count = *counter.lock().unwrap();
        assert_eq!(
            call_count, 1,
            "seed must make exactly 1 factory.connect call per server (not 2), got {call_count}"
        );

        let tools = registry.list_all();
        let mcp: Vec<_> = tools
            .iter()
            .filter(|t| matches!(&t.source, crate::agents::tools::ToolSource::Mcp(_)))
            .collect();
        assert_eq!(mcp.len(), 1, "expected 1 tool after seed");
    }

    // ── RED (fix #2): startup seed must not attempt a handshake for a server
    // whose required bundled runtime isn't installed — it must skip that
    // server distinctly instead of attempting-and-failing the connection.

    #[tokio::test]
    async fn seed_skips_handshake_when_required_runtime_is_not_installed() {
        let (factory, counter) = CountingFactory::new();
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let store = crate::storage::create_test_store();

        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "needs-bun-srv".to_string(),
                    display_name: "Needs Bun".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("npx".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: true,
                    created_at: 6000,
                    updated_at: 6000,
                },
            )
            .unwrap();
        }

        // Not on PATH, and the bundled runtime isn't installed either — the
        // handshake must never be attempted.
        super::seed_enabled_servers(&supervisor, &registry, &store, |_| false, |_| false).await;

        assert_eq!(
            *counter.lock().unwrap(),
            0,
            "must not attempt a handshake when the required runtime isn't installed"
        );
        let tools = registry.list_all();
        assert!(
            tools.is_empty(),
            "no tools should be registered when the handshake was skipped"
        );
    }

    #[tokio::test]
    async fn seed_proceeds_when_required_runtime_is_installed() {
        let (factory, counter) = CountingFactory::new();
        let cfg = SupervisorConfig {
            initial_backoff: Duration::from_millis(10),
            ..SupervisorConfig::default()
        };
        let supervisor = McpSupervisor::new(factory, cfg);
        let registry = Arc::new(crate::agents::tools::ToolRegistry::new());
        let store = crate::storage::create_test_store();

        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "has-bun-srv".to_string(),
                    display_name: "Has Bun".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("npx".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: true,
                    created_at: 6001,
                    updated_at: 6001,
                },
            )
            .unwrap();
        }

        super::seed_enabled_servers(&supervisor, &registry, &store, |_| false, |_| true).await;

        assert_eq!(
            *counter.lock().unwrap(),
            1,
            "must attempt the handshake once the required runtime is reported installed"
        );
    }

    // ── RED (fix #3): the enable-path runtime check must consult PATH first,
    // agreeing with `install.rs`'s equivalent behavior.

    struct AlwaysMissingUv;

    impl super::RuntimeAvailability for AlwaysMissingUv {
        fn needs_download(&self, name: &str) -> Option<u64> {
            match name {
                "uv" => Some(18_000_000),
                _ => None,
            }
        }
    }

    #[tokio::test]
    async fn enable_change_checking_runtime_reports_needs_runtime_when_uvx_not_on_path() {
        let supervisor = make_supervisor();
        let store = crate::storage::create_test_store();
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "uvx-srv".to_string(),
                    display_name: "Uvx Server".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("uvx".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: false,
                    created_at: 7000,
                    updated_at: 7000,
                },
            )
            .unwrap();
        }

        let handle = tauri::test::mock_app();
        handle.manage(Arc::clone(&supervisor));
        handle.manage(Arc::new(crate::agents::tools::ToolRegistry::new()) as ToolRegistryState);
        handle.manage(store);

        let outcome = super::mcp_sync_on_enable_change_checking_runtime(
            handle.handle(),
            "uvx-srv",
            true,
            &AlwaysMissingUv,
            |_| false,
        )
        .await
        .expect("must produce a success-shaped outcome, not a hard error");

        match outcome {
            super::EnableOutcome::NeedsRuntime { name, size_bytes } => {
                assert_eq!(name, "uv");
                assert_eq!(size_bytes, 18_000_000);
            }
            other => panic!("expected NeedsRuntime outcome, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn enable_change_checking_runtime_skips_check_when_uvx_found_on_path() {
        let supervisor = make_supervisor();
        let store = crate::storage::create_test_store();
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "uvx-on-path-srv".to_string(),
                    display_name: "Uvx On PATH".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("uvx".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: false,
                    created_at: 7001,
                    updated_at: 7001,
                },
            )
            .unwrap();
        }

        let handle = tauri::test::mock_app();
        handle.manage(Arc::clone(&supervisor));
        handle.manage(Arc::new(crate::agents::tools::ToolRegistry::new()) as ToolRegistryState);
        handle.manage(store);

        let outcome = super::mcp_sync_on_enable_change_checking_runtime(
            handle.handle(),
            "uvx-on-path-srv",
            true,
            &AlwaysMissingUv,
            |_| true,
        )
        .await
        .expect("enable must succeed when the command is found on PATH");

        assert_eq!(
            outcome,
            super::EnableOutcome::Applied,
            "found-on-PATH must skip the runtime requirement entirely"
        );
    }
}
