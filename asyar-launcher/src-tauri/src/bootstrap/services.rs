//! Services and background daemons bootstrap module.
//!
//! Initializes core runtime services (extension state, file index, MCP servers,
//! scripts watcher, aliases, usage tracking, timers) and background daemons
//! (central scheduler, event hubs, filesystem watchers, browser bridge).

use std::sync::Arc;
use tauri::Manager;

use crate::error::AppError;
use crate::extensions::extension_runtime::{
    ticker as extension_runtime_ticker, ExtensionRuntimeManager, RuntimeConfig,
};
use crate::AppState;

pub fn register_builtin_tools(
    app_handle: &tauri::AppHandle,
    search_state: Arc<crate::search_engine::SearchState>,
) -> Result<(), Box<dyn std::error::Error>> {
    use crate::agents::builtin_tools::{
        calculator::CalculatorTool,
        clipboard::{ClipboardProvider, ClipboardReadTool, ClipboardWriteTool, SystemClipboard},
        fs::{FsReadTool, FsWriteTool},
        search::SearchTool,
        shell::ShellExecTool,
        web_fetch::WebFetchTool,
        web_search::WebSearchTool,
    };

    let registry = app_handle
        .try_state::<crate::agents::tools::ToolRegistryState>()
        .ok_or("ToolRegistry not managed")?;

    registry
        .register_builtin(Arc::new(CalculatorTool::new()))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    let clipboard_provider: Arc<dyn ClipboardProvider> = Arc::new(SystemClipboard);
    registry
        .register_builtin(Arc::new(ClipboardReadTool::new(Arc::clone(
            &clipboard_provider,
        ))))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(ClipboardWriteTool::new(clipboard_provider)))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(FsReadTool::new()))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(FsWriteTool::new()))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(ShellExecTool::new()))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(WebFetchTool::new()))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(WebSearchTool::new()))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    registry
        .register_builtin(Arc::new(SearchTool::new(search_state)))
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    Ok(())
}

pub fn sync_shortcode_triggers(app: &tauri::AppHandle) -> Result<(), AppError> {
    let store = app.state::<crate::storage::DataStore>();
    let conn = store.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT shortcode_trigger 
         FROM agents 
         WHERE silent = 1 AND input_source = 'shortcodeMiss'",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut triggers: Vec<String> = Vec::new();
    for trigger in rows.flatten() {
        if !trigger.trim().is_empty() && !triggers.contains(&trigger) {
            triggers.push(trigger);
        }
    }

    if triggers.is_empty() {
        triggers.push(":".to_string());
    }

    let state = app.state::<AppState>();
    if let Ok(mut guard) = state.shortcode_triggers.lock() {
        *guard = triggers;
    }
    Ok(())
}

/// Initializes core services, registers builtin tools, and sets up state stores.
pub fn init_services(
    app: &mut tauri::App,
    data_store: &Arc<crate::storage::DataStore>,
    search_state: Arc<crate::search_engine::SearchState>,
) -> Result<(), Box<dyn std::error::Error>> {
    register_builtin_tools(app.handle(), search_state.clone())?;

    // Local-first usage recording
    let usage_state = crate::usage::initialize_usage_state(app.handle())?;
    app.manage(Arc::new(usage_state));

    // Walkthrough task registry
    app.manage(Arc::new(
        crate::walkthrough::registry::WalkthroughState::new(),
    ));

    // Opt-in usage share check at launch
    if let Some(usage_state) = app.try_state::<Arc<crate::usage::UsageState>>() {
        use tauri_plugin_store::StoreExt;
        let handle = app.handle().clone();
        let usage_state = usage_state.inner().clone();
        let mode = handle
            .store("settings.dat")
            .ok()
            .and_then(|s| s.get("settings"))
            .map(|v| crate::usage::parse_usage_share_mode(&v.to_string()))
            .unwrap_or(crate::usage::UsageShareMode::Off);

        let today = crate::usage::local_day();
        if let Ok(Some(day)) =
            crate::usage::sender::earliest_unsent_day_before(&usage_state, &today)
        {
            match crate::usage::sender::decide_send_action(mode) {
                crate::usage::sender::SendAction::DoNothing => {}
                crate::usage::sender::SendAction::SendNow => {
                    let st = usage_state.clone();
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let platform = crate::feedback::platform_string();
                        let version = handle.package_info().version.to_string();
                        if let Ok(payload) =
                            crate::usage::sender::build_payload(&st, &day, &version, &platform)
                        {
                            let client = crate::auth::api_client::ApiClient::new();
                            if client.submit_usage_ping(&payload).await.is_ok() {
                                let _ = crate::usage::sender::mark_day_sent(&st, &day);
                            }
                        }
                    });
                }
                crate::usage::sender::SendAction::Prompt => {
                    crate::event_bridge::bridge_emit(&handle, "usage:pending-share", &day);
                }
            }
        }
    }

    // One-shot timer registry
    let timer_registry = crate::timers::TimerRegistry::new(data_store.as_ref().clone());

    // Extension state store + RPC primitive
    let extension_state_service = Arc::new(
        crate::extensions::extension_state::ExtensionStateService::new(data_store.as_ref().clone()),
    );
    extension_state_service.set_emitter(Box::new(
        crate::extensions::extension_state::TauriStateEmitter {
            app: app.handle().clone(),
        },
    ));
    match app.handle().path().app_data_dir() {
        Ok(dir) => log::info!(
            "[extension_state] using SQLite database at {}",
            dir.join("asyar_data.db").display()
        ),
        Err(e) => log::warn!("[extension_state] could not resolve app_data_dir: {e}"),
    }
    app.manage(Arc::clone(&extension_state_service));

    // File index configuration and state
    let file_index_config = {
        use tauri_plugin_store::StoreExt;
        app.handle()
            .store("settings.dat")
            .ok()
            .and_then(|s| s.get("settings"))
            .and_then(|v| v.get("fileSearch").cloned())
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    };
    let file_index_state = Arc::new(crate::file_index::service::FileIndexState::new(
        file_index_config,
    ));
    {
        let conn = data_store.conn()?;
        let rows: Vec<(String, u64, u32, i64)> =
            crate::storage::file_search_selections::load_all(&conn)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|r| {
                    crate::file_index::file_id::from_hex(&r.file_id)
                        .map(|id| (r.query_prefix, id, r.count as u32, r.last_used))
                })
                .collect();
        let pinned: Vec<u64> = crate::storage::file_search_pinned::list(&conn)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|r| crate::file_index::file_id::from_hex(&r.file_id))
            .collect();
        file_index_state.seed_learning(rows, pinned);
    }
    app.manage(file_index_state);
    app.manage(Arc::new(
        crate::file_index::watcher::FileIndexWatcherHandle::new(),
    ));
    app.manage(Arc::new(crate::thumbnail::ThumbnailState::default()));

    // Re-open every pinned note's sticky window
    crate::bootstrap::windows::restore_stickies(app.handle());

    // MCP: wire runtime resolver to the now-available AppHandle
    if let Some(resolver) = app.try_state::<Arc<crate::AppRuntimeResolver>>() {
        resolver.set_app_handle(app.handle().clone());
    }

    // MCP: seed enabled servers at startup
    tauri::async_runtime::block_on(async {
        crate::mcp::lifecycle::mcp_seed_enabled_servers_at_startup(app.handle()).await;
    });

    // MCP: forward supervisor status transitions
    {
        let supervisor = app
            .state::<Arc<crate::mcp::McpSupervisor>>()
            .inner()
            .clone();
        let mut rx = supervisor.subscribe_status();
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            while let Ok(event) = rx.recv().await {
                let _ = tauri::Emitter::emit(&app_handle, "mcp:status_changed", &event);
            }
        });
    }

    // Scripts watcher
    {
        let initial_dirs: Vec<std::path::PathBuf> = {
            let data_store_state = app.state::<crate::storage::DataStore>();
            let conn = data_store_state.conn()?;
            crate::storage::script_directories::list(&conn)?
                .into_iter()
                .map(std::path::PathBuf::from)
                .collect()
        };
        let directories_state = crate::scripts::watcher::build_directories_state(initial_dirs);
        let app_handle_for_emit = app.handle().clone();
        let scripts_watcher =
            crate::scripts::watcher::ScriptsWatcher::start(directories_state, move || {
                crate::event_bridge::bridge_emit(&app_handle_for_emit, "scripts:changed", ());
            })?;
        app.manage(crate::commands::scripts::ScriptsWatcherState(Arc::clone(
            &scripts_watcher,
        )));
    }

    // Alias storage
    {
        let alias_state = crate::aliases::AliasState::new_with_db(
            app.state::<crate::storage::DataStore>().inner().clone(),
        )
        .expect("init alias state");
        if let Ok(live_ids) = search_state.all_ids() {
            let _ = alias_state.prune_orphans(&live_ids);
        }
        app.manage(alias_state);
    }

    // Shortcode triggers
    {
        use tauri::Listener;
        let app_handle_for_agents = app.handle().clone();
        let _ = sync_shortcode_triggers(&app_handle_for_agents);
        app.listen("agents:changed", move |_event| {
            let _ = sync_shortcode_triggers(&app_handle_for_agents);
        });
    }

    // Startup backlog timers
    {
        let now_at_scan = crate::shell::now_millis();
        match timer_registry.due_now(now_at_scan) {
            Ok(due) if !due.is_empty() => {
                let count = due.len();
                log::info!("[timers] catching up {count} overdue timer(s) from previous run");
                let app_handle = app.handle().clone();
                let registry_for_backlog = timer_registry.clone();
                tauri::async_runtime::spawn(async move {
                    let plan = crate::timers::startup::stagger_startup_fires(due, 10);
                    for (desc, delay) in plan {
                        if !delay.is_zero() {
                            tokio::time::sleep(delay).await;
                        }
                        crate::timers::scheduler::fire_one(
                            &app_handle,
                            &registry_for_backlog,
                            desc,
                            crate::shell::now_millis(),
                        );
                    }
                });
            }
            Ok(_) => {}
            Err(e) => log::warn!("[timers] startup scan failed: {e}"),
        }
    }

    // Live scheduler
    crate::timers::scheduler::start(app.handle().clone(), timer_registry.clone());
    app.manage(timer_registry);

    Ok(())
}

/// Spawns all persistent background workers, schedulers, and watchers.
pub fn init_daemons(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Central background scheduler
    {
        let sched = app.state::<crate::scheduler::Scheduler>();
        let handle = app.handle();
        sched.register(crate::app_updater::scheduler::job(handle.clone()));
        sched.register(crate::app_updater::scheduler::idle_restart_job(
            handle.clone(),
        ));
        sched.register(crate::extensions::update_scheduler::job(handle.clone()));
        sched.register(crate::shell::scheduler::job(
            app.state::<crate::shell::ShellProcessRegistry>()
                .inner()
                .clone(),
        ));
        sched.register(crate::notifications::scheduler::job(
            app.state::<Arc<crate::notifications::NotificationActionRegistry>>()
                .inner()
                .clone(),
        ));
    }

    // System-events hub emitter & watcher
    {
        let app_handle_for_events = app.handle().clone();
        let hub: tauri::State<'_, Arc<crate::system_events::SystemEventsHub>> = app.state();
        let hub_arc: Arc<crate::system_events::SystemEventsHub> = hub.inner().clone();
        hub_arc.set_emitter(Box::new(move |extension_id, event| {
            let payload = serde_json::json!({
                "extensionId": extension_id,
                "event": event,
            });
            crate::event_bridge::bridge_emit(
                &app_handle_for_events,
                "asyar:system-event",
                &payload,
            );
            if let Some(mgr) = app_handle_for_events.try_state::<Arc<ExtensionRuntimeManager>>() {
                let now = std::time::Instant::now();
                mgr.enqueue_worker(
                    &extension_id,
                    crate::extensions::extension_runtime::PendingMessage {
                        kind: crate::extensions::extension_runtime::MessageKind::Action,
                        payload,
                        enqueued_at: now,
                        source: crate::extensions::extension_runtime::TriggerSource::Invoke,
                    },
                    now,
                );
            }
        }));
        if let Err(e) = crate::system_events::default_watcher().start(hub_arc) {
            log::warn!("[system_events] watcher start failed: {e}");
        }
    }

    // App-events hub emitter & watcher
    {
        let app_handle_for_app_events = app.handle().clone();
        let hub: tauri::State<'_, Arc<crate::app_events::AppEventsHub>> = app.state();
        let hub_arc: Arc<crate::app_events::AppEventsHub> = hub.inner().clone();
        hub_arc.set_emitter(Box::new(move |extension_id, event| {
            let payload = serde_json::json!({
                "extensionId": extension_id,
                "event": event,
            });
            crate::event_bridge::bridge_emit(
                &app_handle_for_app_events,
                "asyar:app-event",
                &payload,
            );
            if let Some(mgr) = app_handle_for_app_events.try_state::<Arc<ExtensionRuntimeManager>>()
            {
                let now = std::time::Instant::now();
                mgr.enqueue_worker(
                    &extension_id,
                    crate::extensions::extension_runtime::PendingMessage {
                        kind: crate::extensions::extension_runtime::MessageKind::Action,
                        payload,
                        enqueued_at: now,
                        source: crate::extensions::extension_runtime::TriggerSource::Invoke,
                    },
                    now,
                );
            }
        }));
        if let Err(e) = crate::app_events::default_watcher().start(hub_arc) {
            log::warn!("[app_events] watcher start failed: {e}");
        }
    }

    // Index-events hub emitter & application index watcher
    {
        let app_handle_for_index_events = app.handle().clone();
        let hub: tauri::State<'_, Arc<crate::index_events::IndexEventsHub>> = app.state();
        let hub_arc: Arc<crate::index_events::IndexEventsHub> = hub.inner().clone();
        hub_arc.set_emitter(Box::new(move |extension_id, event| {
            let payload = serde_json::json!({
                "extensionId": extension_id,
                "event": event,
            });
            crate::event_bridge::bridge_emit(
                &app_handle_for_index_events,
                "asyar:application-index",
                &payload,
            );
            if let Some(mgr) =
                app_handle_for_index_events.try_state::<Arc<ExtensionRuntimeManager>>()
            {
                let now = std::time::Instant::now();
                mgr.enqueue_worker(
                    &extension_id,
                    crate::extensions::extension_runtime::PendingMessage {
                        kind: crate::extensions::extension_runtime::MessageKind::Action,
                        payload,
                        enqueued_at: now,
                        source: crate::extensions::extension_runtime::TriggerSource::Invoke,
                    },
                    now,
                );
            }
        }));

        let app_handle_for_watcher = app.handle().clone();
        std::thread::spawn(move || {
            match crate::application::IndexWatcher::start(
                app_handle_for_watcher.clone(),
                hub_arc,
                Vec::new(),
            ) {
                Ok(watcher) => {
                    app_handle_for_watcher.manage(watcher);
                }
                Err(e) => {
                    log::warn!("[index_watcher] start failed: {e}");
                }
            }
        });
    }

    // File index startup background scan
    {
        let app_handle_for_file_index = app.handle().clone();
        let file_index_state = app
            .state::<Arc<crate::file_index::service::FileIndexState>>()
            .inner()
            .clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));

            let cfg = file_index_state.config();
            if !cfg.enabled {
                return;
            }
            let snapshot_path = app_handle_for_file_index
                .path()
                .app_data_dir()
                .ok()
                .map(|d| d.join(crate::file_index::snapshot::SNAPSHOT_FILE_NAME));

            if let Some(path) = &snapshot_path {
                file_index_state.load_snapshot_or_empty(path);
            }
            if file_index_state.status().state != crate::file_index::types::IndexStateKind::Ready {
                let roots = if cfg.include_roots.is_empty() {
                    app_handle_for_file_index
                        .path()
                        .home_dir()
                        .map(|h| vec![h])
                        .unwrap_or_default()
                } else {
                    cfg.include_roots
                        .iter()
                        .map(std::path::PathBuf::from)
                        .collect()
                };
                file_index_state.run_full_scan(
                    roots,
                    cfg.exclude_patterns.clone(),
                    crate::file_index::walker::HARD_CAP,
                    crate::file_index::ranking::now_seconds(),
                );
                if let Some(path) = &snapshot_path {
                    let _ = file_index_state.save_snapshot(path);
                }
            }

            let roots = if cfg.include_roots.is_empty() {
                app_handle_for_file_index
                    .path()
                    .home_dir()
                    .map(|h| vec![h])
                    .unwrap_or_default()
            } else {
                cfg.include_roots
                    .iter()
                    .map(std::path::PathBuf::from)
                    .collect()
            };
            if let Some(handle) = app_handle_for_file_index
                .try_state::<Arc<crate::file_index::watcher::FileIndexWatcherHandle>>()
            {
                let exclusions =
                    crate::file_index::watcher::build_exclusion_set(&cfg.exclude_patterns);
                let on_rescan = crate::file_index::commands::make_on_rescan(
                    app_handle_for_file_index.clone(),
                    file_index_state.clone(),
                );
                handle.rearm(roots, exclusions, file_index_state.clone(), on_rescan);
            }

            crate::event_bridge::bridge_emit(
                &app_handle_for_file_index,
                "asyar:file-index-status",
                file_index_state.status(),
            );
        });
    }

    // Fs watcher registry emitter
    {
        let app_handle_for_fs_watch = app.handle().clone();
        let reg: tauri::State<'_, Arc<crate::fs_watcher::FsWatcherRegistry>> = app.state();
        let reg_arc: Arc<crate::fs_watcher::FsWatcherRegistry> = reg.inner().clone();
        reg_arc.set_emitter(Box::new(move |ext_id, handle_id, event| {
            let paths: Vec<String> = event
                .paths
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            let payload = serde_json::json!({
                "extensionId": ext_id,
                "event": {
                    "handleId": handle_id,
                    "change": {
                        "type": "change",
                        "paths": paths,
                    }
                }
            });
            crate::event_bridge::bridge_emit(&app_handle_for_fs_watch, "asyar:fs-watch", &payload);
        }));
    }

    // Apply pending update
    {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            crate::app_updater::service::apply_on_start(&handle).await;
        });
    }

    // Extension runtime ticker
    if let Some(mgr) = app.try_state::<Arc<ExtensionRuntimeManager>>() {
        extension_runtime_ticker::spawn_ticker(
            app.app_handle().clone(),
            mgr.inner().clone(),
            RuntimeConfig::default().view.tick_interval,
        );
    }

    // Autostart plugin
    crate::bootstrap::platform::init_autostart(app.handle());

    // Browser bridge
    {
        use crate::browser::bridge::{
            cache::TabSnapshotCache, connections::CompanionRegistry, pairing::PairingRegistry,
            rate_limit::ConnectionRateLimiter, server::start_server,
            token_store::KeyringTokenStore, BridgeState,
        };

        let token_store = Arc::new(KeyringTokenStore::new());
        let token_store_clone = token_store.clone();
        std::thread::spawn(move || {
            token_store_clone.load_paired_from_backend();
        });

        let bridge_state = BridgeState {
            tokens: token_store,
            pairing: Arc::new(PairingRegistry::new()),
            connections: Arc::new(CompanionRegistry::new()),
            cache: Arc::new(TabSnapshotCache::new()),
            events: Arc::new(crate::browser::events::BrowserEventsHub::new()),
            last_active: Arc::new(std::sync::RwLock::new(None)),
            rate_limiter: Arc::new(ConnectionRateLimiter::default()),
            app_handle: app.handle().clone(),
        };

        let bridge_for_server = bridge_state.clone();
        let app_handle_for_emit = app.handle().clone();
        let app_handle_for_manage = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            match start_server(bridge_for_server).await {
                Ok(handle) => {
                    let port = handle.port();
                    log::info!("browser bridge listening on 127.0.0.1:{}", port);
                    crate::event_bridge::bridge_emit(
                        &app_handle_for_emit,
                        "browser:bridge-ready",
                        serde_json::json!({ "port": port }),
                    );
                    app_handle_for_manage.manage(handle);
                }
                Err(e) => {
                    log::error!("failed to start browser bridge: {}", e);
                }
            }
        });

        app.manage(Arc::clone(&bridge_state.events));
        {
            let app_handle_for_events = app.handle().clone();
            let hub_arc: Arc<crate::browser::events::BrowserEventsHub> =
                Arc::clone(&bridge_state.events);
            hub_arc.set_emitter(Box::new(move |extension_id, event| {
                let payload = serde_json::json!({
                    "extensionId": extension_id,
                    "event": event,
                });
                crate::event_bridge::bridge_emit(
                    &app_handle_for_events,
                    "asyar:browser-event",
                    &payload,
                );
                if let Some(mgr) = app_handle_for_events.try_state::<Arc<ExtensionRuntimeManager>>()
                {
                    let now = std::time::Instant::now();
                    mgr.enqueue_worker(
                        &extension_id,
                        crate::extensions::extension_runtime::PendingMessage {
                            kind: crate::extensions::extension_runtime::MessageKind::Action,
                            payload,
                            enqueued_at: now,
                            source: crate::extensions::extension_runtime::TriggerSource::Invoke,
                        },
                        now,
                    );
                }
            }));
        }

        app.manage(bridge_state);
    }

    Ok(())
}
