#[allow(unused_imports)]
use tauri::{Emitter, Listener, Manager};

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

/// Shared application state managed by Tauri's state system.
pub struct AppState {
    /// When `true`, prevents the launcher window from losing keyboard focus.
    pub focus_locked: AtomicBool,
    /// Maps shortcut strings (e.g. `"Alt+Space"`) to the object ID they activate.
    pub user_shortcuts: Mutex<HashMap<String, String>>,
    /// The current global shortcut string used to show/hide the launcher.
    pub launcher_shortcut: Mutex<String>,
    /// When `true`, the text snippet expansion listener is active.
    pub snippets_enabled: AtomicBool,
    /// Tracks whether the launcher window is currently visible.
    pub asyar_visible: AtomicBool,
    /// Mirrors whether the launcher search box has a non-empty query. Read by
    /// the panel resign handler to decide whether to reset compact geometry
    /// on hide — a user-typed query should keep the expanded view across hides.
    pub launcher_has_query: AtomicBool,
    /// The currently active snippet definitions (keyword → expansion text).
    pub active_snippets: Mutex<HashMap<String, String>>,
    /// Guards against registering the global event listener more than once.
    pub listener_started: AtomicBool,
    /// Handle to the previously focused window, restored when the launcher hides (Windows only).
    #[cfg(target_os = "windows")]
    pub previous_hwnd: Mutex<isize>,
    /// The X11 window ID of the window active before Asyar was shown (Linux only).
    #[cfg(target_os = "linux")]
    pub linux_prev_window_id: Mutex<u64>,
    /// Set during snippet expansion to suppress the monitor from re-triggering.
    pub is_expanding: AtomicBool,
}

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
pub mod commands;
pub mod tray;
pub mod platform;
pub mod error;
pub mod uri_schemes;
mod search_engine;
mod snippets;
pub mod storage;
pub mod permissions;
pub mod extensions;
pub mod profile;
pub mod auth;
pub mod hud_window;
pub mod selection;
pub mod oauth;
pub mod shell;
pub mod application;
pub mod window_management;
pub mod deeplink;
pub mod app_updater;
pub mod power;
pub mod event_hub;
pub mod system_events;
pub mod app_events;
pub mod extension_tray;

pub const SPOTLIGHT_LABEL: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_x::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .register_uri_scheme_protocol("asyar-extension", |ctx, req| {
            uri_schemes::handle_extension_request(ctx.app_handle(), req)
        })
        .register_uri_scheme_protocol("asyar-icon", |ctx, req| {
            uri_schemes::handle_icon_request(ctx.app_handle(), req)
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    commands::handle_shortcut(app, shortcut, event);
                })
                .build(),
        )
        .manage(extensions::headless::HeadlessRegistry(Mutex::new(HashMap::new())))
        .manage(extensions::ExtensionRegistryState::new())
        .manage(permissions::ExtensionPermissionRegistry::new())
        .manage(auth::state::AuthState::default())
        .manage(auth::api_client::ApiClient::new())
        .manage(oauth::OAuthPendingFlowState::new())
        .manage(hud_window::HudState::default())
        .manage(shell::ShellProcessRegistry::new())
        .manage(extensions::scheduler::SchedulerState::new())
        .manage(app_updater::AppUpdaterState::new())
        .manage(power::PowerRegistry::new(power::default_backend()))
        .manage(std::sync::Arc::new(system_events::SystemEventsHub::new()))
        .manage(std::sync::Arc::new(app_events::AppEventsHub::new()))
        .manage::<std::sync::Arc<dyn app_events::AppPresenceQuery>>(
            std::sync::Arc::from(app_events::default_presence_query()),
        )
        .manage(AppState {
            focus_locked: AtomicBool::new(false),
            user_shortcuts: Mutex::new(HashMap::new()),
            launcher_shortcut: Mutex::new(String::from("Alt+Space")),
            snippets_enabled: AtomicBool::new(false),
            asyar_visible: AtomicBool::new(false),
            launcher_has_query: AtomicBool::new(false),
            active_snippets: Mutex::new(HashMap::new()),
            listener_started: AtomicBool::new(false),
            #[cfg(target_os = "windows")]
            previous_hwnd: Mutex::new(0),
            #[cfg(target_os = "linux")]
            linux_prev_window_id: Mutex::new(0),
            is_expanding: AtomicBool::new(false),
        })
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            commands::set_focus_lock,
            commands::set_launcher_has_query,
            commands::set_launcher_height,
            commands::mark_launcher_ready,
            commands::update_show_more_bar_style,
            commands::quit_app,
            commands::list_applications,
            commands::sync_application_index,
            commands::get_frontmost_application,
            commands::get_default_app_scan_paths,
            commands::normalize_scan_path,
            commands::show,
            commands::hide,
            commands::show_hud,
            commands::hide_hud,
            commands::get_hud_title,
            commands::simulate_paste,
            commands::update_global_shortcut,
            commands::get_persisted_shortcut,
            commands::initialize_shortcut_from_settings,
            commands::initialize_autostart_from_settings,
            commands::get_autostart_status,
            commands::check_path_exists,
            commands::uninstall_extension,
            commands::install_extension_from_url, 
            commands::open_application_path,
            commands::get_extensions_dir,
            commands::list_installed_extensions,
            commands::get_builtin_features_path,
            commands::register_dev_extension,
            commands::get_dev_extension_paths,
            commands::discover_extensions,
            commands::set_extension_enabled,
            commands::get_extension,
            commands::get_scheduled_tasks,
            search_engine::commands::index_item,
            search_engine::commands::batch_index_items,
            search_engine::commands::save_search_index,
            search_engine::commands::search_items,
            search_engine::commands::merged_search,
            search_engine::commands::sync_command_index,
            search_engine::commands::get_indexed_object_ids,
            search_engine::commands::delete_item,
            search_engine::commands::reset_search_index,
            search_engine::commands::record_item_usage,
            search_engine::commands::update_command_metadata,
            commands::write_binary_file_recursive,
            commands::write_text_file_absolute,
            commands::read_text_file_absolute,
            commands::mkdir_absolute,
            commands::spawn_headless_extension,
            commands::kill_extension,
            commands::check_extension_updates,
            commands::update_extension,
            commands::update_all_extensions,
            commands::fetch_url,
            commands::send_notification,
            commands::register_item_shortcut,
            commands::unregister_item_shortcut,
            commands::pause_user_shortcuts,
            commands::resume_user_shortcuts,
            commands::pause_all_shortcuts,
            commands::resume_all_shortcuts,
            commands::get_current_platform,
            extension_tray::commands::tray_register_item,
            extension_tray::commands::tray_update_item,
            extension_tray::commands::tray_unregister_item,
            extension_tray::commands::tray_remove_all_for_extension,
            commands::expand_and_paste,
            commands::sync_snippets_to_rust,
            commands::set_snippets_enabled,
            commands::check_snippet_permission,
            commands::open_accessibility_preferences,
            permissions::register_extension_permissions,
            permissions::check_extension_permission,
            commands::auth_initiate,
            commands::auth_poll,
            commands::auth_load_cached,
            commands::auth_get_state,
            commands::auth_refresh_entitlements,
            commands::auth_check_entitlement,
            commands::auth_logout,
            commands::sync_upload,
            commands::sync_download,
            commands::sync_get_status,
            commands::export_profile,
            commands::import_profile,
            commands::show_save_profile_dialog,
            commands::show_open_profile_dialog,
            commands::install_extension_from_file,
            commands::show_open_extension_dialog,
            commands::get_theme_definition,
            commands::get_valid_shortcut_keys,
            // Storage: clipboard
            storage::commands::clipboard_add_item,
            storage::commands::clipboard_get_all,
            storage::commands::clipboard_toggle_favorite,
            storage::commands::clipboard_delete_item,
            storage::commands::clipboard_clear_non_favorites,
            storage::commands::clipboard_find_duplicate,
            storage::commands::clipboard_cleanup,
            storage::commands::clipboard_record_capture,
            // Storage: snippets
            storage::commands::snippet_upsert,
            storage::commands::snippet_get_all,
            storage::commands::snippet_remove,
            storage::commands::snippet_toggle_pin,
            storage::commands::snippet_clear_all,
            // Storage: shortcuts
            storage::commands::shortcut_upsert,
            storage::commands::shortcut_get_all,
            storage::commands::shortcut_remove,
            // Storage: extension key-value
            storage::commands::ext_kv_get,
            storage::commands::ext_kv_set,
            storage::commands::ext_kv_delete,
            storage::commands::ext_kv_get_all,
            storage::commands::ext_kv_clear,
            // Storage: extension cache
            storage::commands::ext_cache_get,
            storage::commands::ext_cache_set,
            storage::commands::ext_cache_delete,
            storage::commands::ext_cache_clear,
            commands::get_selected_text,
            commands::get_selected_finder_items,
            // OAuth PKCE for extensions
            commands::oauth_start_flow,
            commands::oauth_exchange_code,
            commands::oauth_get_stored_token,
            commands::oauth_revoke_extension_token,
            commands::shell_spawn,
            commands::shell_kill,
            commands::shell_resolve_path,
            commands::shell_check_trust,
            commands::shell_grant_trust,
            commands::shell_revoke_trust,
            commands::shell_list_trusted,
            commands::show_in_file_manager,
            commands::trash_path,
            commands::extension_preferences_get_all,
            commands::extension_preferences_set,
            commands::extension_preferences_reset,
            commands::extension_preferences_export_all,
            commands::extension_preferences_import_all,
            commands::window_management_get_bounds,
            commands::window_management_set_bounds,
            commands::window_management_set_fullscreen,
            commands::app_updater_check_now,
            commands::app_updater_get_pending,
            commands::app_relaunch,
            commands::app_updater_should_show_whats_new,
            commands::power_keep_awake,
            commands::power_release,
            commands::power_list,
            commands::system_events_subscribe,
            commands::system_events_unsubscribe,
            commands::app_events_subscribe,
            commands::app_events_unsubscribe,
            commands::app_is_running,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Reads `settings.appearance.launchView` from `settings.dat` synchronously,
/// so setup_app can seed the correct launcher geometry before `panel.show()`.
/// Falling back to "default" matches the JS DEFAULT_SETTINGS for fresh installs.
///
/// CONTRACT: the JSON path `settings → appearance → launchView` must match
/// what `src/services/settings/settingsService.svelte.ts` writes via
/// `store.set("settings", currentSettings)`. The TS test
/// `rust_read_launch_view_contract` in `settingsService.test.ts` guards the
/// TS side; the Rust tests below guard the parsing logic.
fn read_launch_view(app: &tauri::AppHandle) -> &'static str {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store("settings.dat") else { return "default"; };
    parse_launch_view(store.get("settings").as_ref())
}

/// Pure JSON-navigation helper extracted from `read_launch_view`. Returns
/// `"compact"` only when the value at `appearance.launchView` is the string
/// `"compact"`; any other shape or value yields `"default"`.
fn parse_launch_view(settings_root: Option<&serde_json::Value>) -> &'static str {
    let is_compact = settings_root
        .and_then(|s| s.get("appearance"))
        .and_then(|a| a.get("launchView"))
        .and_then(|v| v.as_str())
        == Some("compact");
    if is_compact { "compact" } else { "default" }
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    tray::setup_tray(app)?;

    // Extension-tray manager. Each `registerItem(...)` call from an extension
    // creates an independent menu-bar `TrayIcon`; this state tracks the live
    // ones and routes click events back to the originating extension.
    {
        use std::sync::Arc;
        let lookup: Arc<dyn extension_tray::icon::ExtensionDirLookup + Send + Sync> =
            Arc::new(extension_tray::extension_lookup::AppHandleExtensionDirLookup::new(
                app.handle().clone(),
            ));
        let backend = extension_tray::backend::TauriTrayBackend::new(
            app.handle().clone(),
            lookup,
        );
        app.manage(extension_tray::ExtensionTrayManager::new(Box::new(backend)));
    }
    
    // Deep link handler — routes incoming asyar:// URLs.
    // Extension deep links (asyar://extensions/{extId}/{cmdId}?args) are parsed
    // in Rust and emitted as a typed "asyar:deeplink:extension" event.
    // All other URLs (auth, OAuth) are emitted as raw "asyar:deep-link" strings.
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        let handle = app.handle().clone();
        app.deep_link().on_open_url(move |event| {
            let urls: Vec<String> = event.urls().iter()
                .map(|u| u.to_string())
                .collect();
            for url in urls {
                if url.starts_with("asyar://extensions/") {
                    match deeplink::parse_extension_deeplink(&url) {
                        Some(payload) => {
                            log::info!("[Deeplink] Extension trigger: {}/{}", payload.extension_id, payload.command_id);
                            let _ = handle.emit("asyar:deeplink:extension", payload);
                        }
                        None => {
                            log::warn!("[Deeplink] Failed to parse extension URL: {}", url);
                        }
                    }
                } else {
                    let _ = handle.emit("asyar:deep-link", url);
                }
            }
        });
    }

    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let handle = app.app_handle();
    let window = handle.get_webview_window(SPOTLIGHT_LABEL)
        .ok_or("Main launcher window not found")?;
    
    #[cfg(target_os = "macos")]
    let panel = crate::platform::macos::setup_spotlight_window(&window, handle)?;

    // Seed the launcher geometry from the persisted launchView BEFORE the
    // first panel.show(), so compact users never see the 560→96 reflow that
    // a JS-side crop would produce (settings load sits behind appInitializer).
    let compact = read_launch_view(handle) == "compact";

    // Pin the webview + vibrancy at max height and build the native Show More
    // bar so compact↔expanded resizes stay frame-perfect: setFrame + webview
    // reposition + bar setHidden: commit to one CATransaction, no DOM reflow.
    #[cfg(target_os = "macos")]
    {
        use crate::platform::macos::{LAUNCHER_COMPACT_HEIGHT, LAUNCHER_MAX_HEIGHT};
        crate::platform::macos::pin_launcher_webview(&window);
        crate::platform::macos::create_show_more_bar(&window, handle.clone());
        let height = if compact { LAUNCHER_COMPACT_HEIGHT } else { LAUNCHER_MAX_HEIGHT };
        // Size only — the bar is created setHidden:YES so cold-start paint
        // latency never shows "bar visible, header blank". The frontend's
        // onMount rAF calls mark_launcher_ready to flip it in the same
        // CATransaction as WebKit's first painted frame.
        crate::platform::macos::set_launcher_window_height(&window, height, None);
    }

    // Non-macOS: plain resize while still hidden — the hotkey handler shows it.
    #[cfg(not(target_os = "macos"))]
    if compact {
        use tauri::{LogicalSize, Size};
        if let Ok(size) = window.inner_size() {
            let scale = window.scale_factor().unwrap_or(1.0);
            let logical_width = size.width as f64 / scale;
            let _ = window.set_size(Size::Logical(LogicalSize { width: logical_width, height: 96.0 }));
        }
    }

    #[cfg(target_os = "macos")]
    crate::platform::macos::register_cmdq_monitor(handle.clone());

    #[cfg(target_os = "windows")]
    let _ = crate::platform::windows::setup_spotlight_window(&window);

    #[cfg(target_os = "linux")]
    let _ = crate::platform::linux::setup_spotlight_window(&window);

    // Initialize the search state when the app starts
    let state = search_engine::initialize_search_state(app.handle())?;
    app.manage(state);

    // Initialize the SQLite data store for clipboard, snippets, shortcuts
    let data_store = storage::DataStore::initialize(app.handle())?;
    
    // Prune all expired cache entries on setup
    {
        let conn = data_store.conn()?;
        let _ = storage::extension_cache::prune_all_expired(&conn);
    }
    
    app.manage(data_store);

    // Setup panel event listener
    #[cfg(target_os = "macos")]
    {
        let handle_clone = handle.clone();
        handle.listen(
            format!("{}_panel_did_resign_key", SPOTLIGHT_LABEL),
            move |_| {
                let state = handle_clone.state::<AppState>();
                if state.focus_locked.load(Ordering::Relaxed) { return; }
                state.asyar_visible.store(false, Ordering::Relaxed);

                // If the user pressed Show More and then hid without typing,
                // collapse to compact geometry before the window goes away —
                // otherwise the next panel.show() paints the stale 560 frame
                // before JS can shrink it. A non-empty query is a real
                // expansion the user wants to keep, so skip then.
                let compact_mode = read_launch_view(&handle_clone) == "compact";
                let has_query = state.launcher_has_query.load(Ordering::Relaxed);
                let handle_for_main = handle_clone.clone();
                let panel = panel.clone();
                let _ = handle_clone.run_on_main_thread(move || {
                    if compact_mode && !has_query {
                        if let Some(window) = handle_for_main.get_webview_window(SPOTLIGHT_LABEL) {
                            crate::platform::macos::set_launcher_window_height(
                                &window,
                                crate::platform::macos::LAUNCHER_COMPACT_HEIGHT,
                                Some(false),
                            );
                        }
                    }
                    panel.order_out(None);
                });
            },
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        let handle_clone = handle.clone();
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let state = handle_clone.state::<AppState>();
                if !state.focus_locked.load(Ordering::Relaxed) {
                    state.asyar_visible.store(false, Ordering::Relaxed);
                    let _ = window_clone.hide();
                }
            }
        });
    }

    // Resize on launchView change. rAF is throttled in a hidden WKWebView so
    // the launcher's own JS $effect can't be relied on — without this Rust
    // handler the next panel.show() would flash at the previous height before
    // WebKit resumes rendering. Listener fires off-main-thread, so AppKit
    // calls must hop to the main thread.
    {
        let handle_for_listen = handle.clone();
        handle.listen("asyar:launch-view-changed", move |event| {
            let compact = serde_json::from_str::<serde_json::Value>(event.payload())
                .ok()
                .and_then(|v| v.get("launchView").and_then(|s| s.as_str()).map(|s| s.to_owned()))
                .as_deref()
                == Some("compact");

            let handle_for_main = handle_for_listen.clone();
            let _ = handle_for_listen.run_on_main_thread(move || {
                let Some(window) = handle_for_main.get_webview_window(SPOTLIGHT_LABEL) else { return; };

                #[cfg(target_os = "macos")]
                {
                    use crate::platform::macos::{LAUNCHER_COMPACT_HEIGHT, LAUNCHER_MAX_HEIGHT};
                    let height = if compact { LAUNCHER_COMPACT_HEIGHT } else { LAUNCHER_MAX_HEIGHT };
                    crate::platform::macos::set_launcher_window_height(
                        &window,
                        height,
                        Some(!compact),
                    );
                }

                #[cfg(not(target_os = "macos"))]
                {
                    use tauri::{LogicalSize, Size};
                    let height = if compact { 96.0 } else { 560.0 };
                    if let Ok(size) = window.inner_size() {
                        let scale = window.scale_factor().unwrap_or(1.0);
                        let logical_width = size.width as f64 / scale;
                        let _ = window.set_size(Size::Logical(LogicalSize {
                            width: logical_width,
                            height,
                        }));
                    }
                }
            });
        });
    }

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};
        if apply_acrylic(&window, Some((0, 0, 0, 0))).is_err() {
            let _ = apply_mica(&window, None);
        }
    }

    // Prevent the settings window from being destroyed on close — hide it instead
    if let Some(settings_window) = handle.get_webview_window("settings") {
        let sw = settings_window.clone();
        settings_window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = sw.hide();
            }
        });
    }

    // Setup global shortcut with default configuration
    setup_global_shortcut(handle);

    // Spawn background app update scheduler
    crate::app_updater::scheduler::start(app.handle().clone());

    // Spawn background extension update scheduler (emits asyar:extension-update:tick hourly)
    crate::extensions::update_scheduler::start(app.handle().clone());

    // Wire the system-events hub emitter to Tauri's AppHandle and start the
    // per-platform watcher. The hub is a singleton for the app lifetime.
    {
        let app_handle_for_events = app.handle().clone();
        let hub: tauri::State<'_, std::sync::Arc<system_events::SystemEventsHub>> = app.state();
        let hub_arc: std::sync::Arc<system_events::SystemEventsHub> = hub.inner().clone();
        hub_arc.set_emitter(Box::new(move |extension_id, event| {
            let payload = serde_json::json!({
                "extensionId": extension_id,
                "event": event,
            });
            if let Err(e) = app_handle_for_events.emit("asyar:system-event", payload) {
                log::warn!("[system_events] failed to emit Tauri event: {e}");
            }
        }));
        if let Err(e) = system_events::default_watcher().start(hub_arc) {
            log::warn!("[system_events] watcher start failed: {e}");
        }
    }

    // Wire the app-events hub emitter + start the per-platform watcher.
    // Symmetrical with the system-events block above; emits on the
    // `asyar:app-event` Tauri channel.
    {
        let app_handle_for_app_events = app.handle().clone();
        let hub: tauri::State<'_, std::sync::Arc<app_events::AppEventsHub>> = app.state();
        let hub_arc: std::sync::Arc<app_events::AppEventsHub> = hub.inner().clone();
        hub_arc.set_emitter(Box::new(move |extension_id, event| {
            let payload = serde_json::json!({
                "extensionId": extension_id,
                "event": event,
            });
            if let Err(e) = app_handle_for_app_events.emit("asyar:app-event", payload) {
                log::warn!("[app_events] failed to emit Tauri event: {e}");
            }
        }));
        if let Err(e) = app_events::default_watcher().start(hub_arc) {
            log::warn!("[app_events] watcher start failed: {e}");
        }
    }

    // Apply any pending update from previous session.
    // Runs async in the background. Events emitted here (e.g. asyar:app-update:ready)
    // may be missed if the webview is not yet ready; the frontend's on-mount poll via
    // app_updater_get_pending handles recovery for that case.
    {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            crate::app_updater::service::apply_on_start(&handle).await;
        });
    }

    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::MacosLauncher;
        use tauri_plugin_autostart::ManagerExt;

        // Initialize the autostart plugin but don't change settings
        // Let the frontend handle enabling/disabling based on persisted settings
        let _ = app.handle().plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ));

        // Note: We're not enabling or disabling here to avoid overriding
        // the user settings. The JS settings service will handle this.
        let autostart_manager = app.autolaunch();
        log::info!(
            "current autostart status: {}",
            autostart_manager.is_enabled().unwrap_or(false)
        );
    }

    Ok(())
}

fn setup_global_shortcut(app_handle: &tauri::AppHandle) {
    // Use default shortcut configuration initially
    let shortcut_config = commands::ShortcutConfig::default();

    // Get the global shortcut manager
    let shortcut_manager = app_handle.global_shortcut();

    // Convert stored config to modifiers and code
    let mod_key = match shortcut_config.modifier.as_str() {
        "Super" => Modifiers::SUPER,
        "Shift" => Modifiers::SHIFT,
        "Control" => Modifiers::CONTROL,
        "Alt" => Modifiers::ALT,
        _ => Modifiers::ALT, // Default to ALT if invalid
    };

    let code = match commands::get_code_from_string(&shortcut_config.key) {
        Ok(code) => code,
        Err(_) => Code::Space, // Default to Space if invalid
    };

    // Register the shortcut without a handler (it will be handled by the global handler)
    let shortcut = Shortcut::new(Some(mod_key), code);

    // Register the shortcut
    if let Err(e) = shortcut_manager.register(shortcut) {
        log::error!("Failed to register shortcut: {}", e);
    }
}

#[cfg(test)]
mod launch_view_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn returns_compact_at_canonical_path() {
        let v = json!({ "appearance": { "launchView": "compact" } });
        assert_eq!(parse_launch_view(Some(&v)), "compact");
    }

    #[test]
    fn returns_default_when_value_is_default() {
        let v = json!({ "appearance": { "launchView": "default" } });
        assert_eq!(parse_launch_view(Some(&v)), "default");
    }

    #[test]
    fn returns_default_when_settings_root_is_none() {
        assert_eq!(parse_launch_view(None), "default");
    }

    #[test]
    fn returns_default_when_appearance_key_missing() {
        let v = json!({ "general": { "startAtLogin": false } });
        assert_eq!(parse_launch_view(Some(&v)), "default");
    }

    #[test]
    fn returns_default_when_launch_view_key_missing() {
        let v = json!({ "appearance": { "theme": "dark", "windowWidth": 800 } });
        assert_eq!(parse_launch_view(Some(&v)), "default");
    }

    #[test]
    fn returns_default_when_launch_view_is_not_string() {
        let v = json!({ "appearance": { "launchView": 42 } });
        assert_eq!(parse_launch_view(Some(&v)), "default");
    }

    #[test]
    fn returns_default_for_unrecognised_string_value() {
        let v = json!({ "appearance": { "launchView": "ultrawide" } });
        assert_eq!(parse_launch_view(Some(&v)), "default");
    }

    /// Uses the exact shape that `DEFAULT_SETTINGS` in
    /// `settingsService.svelte.ts` produces — guards against accidental
    /// path drift on the Rust side of the contract.
    #[test]
    fn extracts_from_full_default_settings_shape() {
        let v = json!({
            "general": { "startAtLogin": false, "showDockIcon": true },
            "search": { "searchApplications": true },
            "shortcut": { "modifier": "Alt", "key": "Space" },
            "appearance": {
                "theme": "system",
                "launchView": "compact",
                "windowWidth": 800,
                "windowHeight": 600,
            },
            "extensions": { "enabled": {}, "autoUpdate": true },
            "updates": { "channel": "stable", "autoCheck": true },
            "ai": { "providers": {}, "temperature": 0.7, "maxTokens": 2048 },
        });
        assert_eq!(parse_launch_view(Some(&v)), "compact");
    }
}

