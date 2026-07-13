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
/// fail with an error the user can't act on. `path_probe` is injectable
/// (fix #3) so tests don't depend on the ambient system PATH.
///
/// On success, registers or releases `"mcp:<server_id>"` as a consumer of
/// whichever bundled runtime this server's transport needs (if any), so
/// Settings' "remove runtime" warning stays accurate as servers are toggled.
/// `runtime_manager` takes no `AppHandle`, so this stays testable with
/// `tauri::test::mock_app()` even though it's generic over `<R:
/// tauri::Runtime>` — unlike the `_ensuring` wrapper below, which needs a
/// concrete `&tauri::AppHandle` for its network-backed `ensure()` call.
pub async fn mcp_sync_on_enable_change_checking_runtime<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    runtime_manager: &crate::runtimes::RuntimeManager,
    server_id: &str,
    enabled: bool,
    runtime_availability: &dyn RuntimeAvailability,
    path_probe: impl Fn(&str) -> bool,
) -> Result<EnableOutcome, AppError> {
    let store = app
        .try_state::<crate::storage::DataStore>()
        .ok_or_else(|| AppError::Other("DataStore not managed".to_string()))?;
    let row = {
        let conn = store.conn()?;
        mcp_servers::get_server(&conn, server_id)?
            .ok_or_else(|| AppError::NotFound(format!("MCP server '{}' not found", server_id)))?
    };
    let transport = transport_from_row(&row)?;
    let required_runtime = required_runtime_for_command_with_probe(&transport, path_probe);

    if enabled {
        if let Some(name) = required_runtime {
            if let Some(size_bytes) = runtime_availability.needs_download(name) {
                return Ok(EnableOutcome::NeedsRuntime {
                    name: name.to_string(),
                    size_bytes,
                });
            }
        }
    }

    mcp_sync_on_enable_change(app, server_id, enabled).await?;

    if let Some(name) = required_runtime {
        let consumer = format!("mcp:{server_id}");
        if enabled {
            runtime_manager.add_consumer(name, &consumer);
        } else {
            runtime_manager.remove_consumer(name, &consumer);
        }
    }

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

    mcp_sync_on_enable_change_checking_runtime(
        app,
        runtime_manager,
        server_id,
        enabled,
        &availability,
        probe,
    )
    .await
}

/// Wire shape for `mcp_set_server_enabled`'s response (fix #9: lives next to
/// `EnableOutcome`, not in `commands/mcp.rs`). `#[serde(untagged)]` means
/// the normal-success case serializes as a bare `true`, while the
/// needs-runtime case carries an explicit `kind: "needsRuntime"`.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum McpSetEnabledOutcomeResponse {
    NeedsRuntime {
        kind: &'static str,
        name: String,
        #[serde(rename = "sizeBytes")]
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
/// registered tools, releases this server's runtime consumer registration
/// (if its transport needed one — mirrors `extensions/lifecycle.rs`'s
/// uninstall releasing `"ext:<id>"`), and deletes the persisted rows
/// (server, audit, permissions). `runtime_manager` takes no `AppHandle`, so
/// this stays generic over `<R: tauri::Runtime>` and testable with
/// `tauri::test::mock_app()`. `path_probe` is injectable (mirrors every
/// other PATH-aware check in this module) so tests don't depend on whether
/// the machine running them happens to have `npx`/`uvx` on PATH.
pub async fn mcp_cleanup_on_delete<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    runtime_manager: &crate::runtimes::RuntimeManager,
    server_id: &str,
    path_probe: impl Fn(&str) -> bool,
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

    let required_runtime = {
        let conn = store.conn()?;
        mcp_servers::get_server(&conn, server_id)?
            .as_ref()
            .and_then(|row| transport_from_row(row).ok())
            .and_then(|transport| required_runtime_for_command_with_probe(&transport, &path_probe))
    };

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

    if let Some(name) = required_runtime {
        runtime_manager.remove_consumer(name, &format!("mcp:{server_id}"));
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

    #[test]
    fn needs_runtime_wire_shape_uses_camel_case_size_bytes_field() {
        // Same regression class as install.rs's equivalent test — see that
        // comment for why `rename_all` on the enum isn't enough here.
        let response = McpSetEnabledOutcomeResponse::from(EnableOutcome::NeedsRuntime {
            name: "uv".to_string(),
            size_bytes: 47_185_920,
        });
        let value: serde_json::Value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["sizeBytes"], 47_185_920);
        assert!(
            value.get("size_bytes").is_none(),
            "must not also serialize the raw snake_case field name"
        );
    }

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

    // ── RED: deleting an MCP server whose transport needs a bundled runtime
    // must release its "mcp:<server_id>" consumer registration, mirroring
    // how `extensions/lifecycle.rs` releases `"ext:<id>"` on uninstall.
    // `mcp_cleanup_on_delete` is generic over `<R: tauri::Runtime>`, so it
    // stays testable with `tauri::test::mock_app()` even after gaining a
    // `runtime_manager` parameter.

    #[tokio::test]
    async fn cleanup_on_delete_releases_runtime_consumer_registration() {
        let supervisor = make_supervisor();
        let store = crate::storage::create_test_store();

        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &crate::storage::mcp_servers::McpServerRow {
                    id: "npx-delete-srv".to_string(),
                    display_name: "NPX Delete Server".to_string(),
                    description: None,
                    transport_kind: "stdio".to_string(),
                    command: Some("npx".to_string()),
                    args_json: "[]".to_string(),
                    env_json: "{}".to_string(),
                    url: None,
                    headers_json: "{}".to_string(),
                    enabled: true,
                    created_at: 9000,
                    updated_at: 9000,
                },
            )
            .unwrap();
        }

        let runtime_manager = crate::runtimes::RuntimeManager::new();
        runtime_manager.add_consumer("bun", "mcp:npx-delete-srv");

        let handle = tauri::test::mock_app();
        handle.manage(Arc::clone(&supervisor));
        handle.manage(Arc::new(crate::agents::tools::ToolRegistry::new()) as ToolRegistryState);
        handle.manage(store);

        super::mcp_cleanup_on_delete(handle.handle(), &runtime_manager, "npx-delete-srv", |_| {
            false
        })
        .await
        .expect("cleanup failed");

        assert!(
            runtime_manager.consumers_of("bun").is_empty(),
            "deleting the server must release its bun consumer registration"
        );
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

        let runtime_manager = crate::runtimes::RuntimeManager::new();
        let outcome = super::mcp_sync_on_enable_change_checking_runtime(
            handle.handle(),
            &runtime_manager,
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

        let runtime_manager = crate::runtimes::RuntimeManager::new();
        let outcome = super::mcp_sync_on_enable_change_checking_runtime(
            handle.handle(),
            &runtime_manager,
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

    // ── RED: enabling a server whose transport needs a bundled runtime must
    // register "mcp:<server_id>" as a consumer of it; disabling must release
    // that registration. Exercised through the generic
    // `mcp_sync_on_enable_change_checking_runtime` (testable with
    // `tauri::test::mock_app()` since it's generic over `<R: tauri::Runtime>`
    // — unlike its `_ensuring` wrapper, which needs a concrete
    // `&tauri::AppHandle` `mock_app()` cannot produce).

    struct AlwaysInstalled;

    impl super::RuntimeAvailability for AlwaysInstalled {
        fn needs_download(&self, _name: &str) -> Option<u64> {
            None
        }
    }

    fn make_uvx_server_row(id: &str, enabled: bool) -> crate::storage::mcp_servers::McpServerRow {
        crate::storage::mcp_servers::McpServerRow {
            id: id.to_string(),
            display_name: id.to_string(),
            description: None,
            transport_kind: "stdio".to_string(),
            command: Some("uvx".to_string()),
            args_json: "[]".to_string(),
            env_json: "{}".to_string(),
            url: None,
            headers_json: "{}".to_string(),
            enabled,
            created_at: 8000,
            updated_at: 8000,
        }
    }

    #[tokio::test]
    async fn enable_change_checking_runtime_registers_consumer_on_successful_enable() {
        let supervisor = make_supervisor();
        let store = crate::storage::create_test_store();
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(&conn, &make_uvx_server_row("uvx-e", false))
                .unwrap();
        }

        let handle = tauri::test::mock_app();
        handle.manage(Arc::clone(&supervisor));
        handle.manage(Arc::new(crate::agents::tools::ToolRegistry::new()) as ToolRegistryState);
        handle.manage(store);

        let runtime_manager = crate::runtimes::RuntimeManager::new();
        let outcome = super::mcp_sync_on_enable_change_checking_runtime(
            handle.handle(),
            &runtime_manager,
            "uvx-e",
            true,
            &AlwaysInstalled,
            |_| false,
        )
        .await
        .expect("enable must succeed when uv is reported already installed");

        assert_eq!(outcome, super::EnableOutcome::Applied);
        assert_eq!(
            runtime_manager.consumers_of("uv"),
            vec!["mcp:uvx-e".to_string()],
            "enabling a uvx-backed server must register it as a uv consumer"
        );
    }

    #[tokio::test]
    async fn enable_change_checking_runtime_releases_consumer_on_disable() {
        let supervisor = make_supervisor();
        let store = crate::storage::create_test_store();
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(&conn, &make_uvx_server_row("uvx-d", true))
                .unwrap();
        }

        let handle = tauri::test::mock_app();
        handle.manage(Arc::clone(&supervisor));
        handle.manage(Arc::new(crate::agents::tools::ToolRegistry::new()) as ToolRegistryState);
        handle.manage(store);

        let runtime_manager = crate::runtimes::RuntimeManager::new();
        runtime_manager.add_consumer("uv", "mcp:uvx-d");

        let outcome = super::mcp_sync_on_enable_change_checking_runtime(
            handle.handle(),
            &runtime_manager,
            "uvx-d",
            false,
            &AlwaysInstalled,
            |_| false,
        )
        .await
        .expect("disable must succeed");

        assert_eq!(outcome, super::EnableOutcome::Applied);
        assert!(
            runtime_manager.consumers_of("uv").is_empty(),
            "disabling a uvx-backed server must release its uv consumer registration"
        );
    }

    #[tokio::test]
    async fn enable_change_checking_runtime_does_not_register_consumer_when_found_on_path() {
        let supervisor = make_supervisor();
        let store = crate::storage::create_test_store();
        {
            let conn = store.conn().unwrap();
            crate::storage::mcp_servers::insert_server(
                &conn,
                &make_uvx_server_row("uvx-on-path-e", false),
            )
            .unwrap();
        }

        let handle = tauri::test::mock_app();
        handle.manage(Arc::clone(&supervisor));
        handle.manage(Arc::new(crate::agents::tools::ToolRegistry::new()) as ToolRegistryState);
        handle.manage(store);

        let runtime_manager = crate::runtimes::RuntimeManager::new();
        let outcome = super::mcp_sync_on_enable_change_checking_runtime(
            handle.handle(),
            &runtime_manager,
            "uvx-on-path-e",
            true,
            &AlwaysInstalled,
            |_| true,
        )
        .await
        .expect("enable must succeed when found on PATH");

        assert_eq!(outcome, super::EnableOutcome::Applied);
        assert!(
            runtime_manager.consumers_of("uv").is_empty(),
            "a command already on PATH needs no bundled runtime, so no consumer must be registered"
        );
    }
}
