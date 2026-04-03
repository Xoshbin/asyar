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
    /// The currently active snippet definitions (keyword → expansion text).
    pub active_snippets: Mutex<HashMap<String, String>>,
    /// Guards against registering the global event listener more than once.
    pub listener_started: AtomicBool,
    /// Handle to the previously focused window, restored when the launcher hides (Windows only).
    #[cfg(target_os = "windows")]
    pub previous_hwnd: Mutex<isize>,
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
pub mod permissions;
pub mod extensions;
pub mod profile;

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
        .plugin(tauri_plugin_updater::Builder::new().build());

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
        .manage(AppState { 
            focus_locked: AtomicBool::new(false),
            user_shortcuts: Mutex::new(HashMap::new()),
            launcher_shortcut: Mutex::new(String::from("Alt+Space")),
            snippets_enabled: AtomicBool::new(false),
            asyar_visible: AtomicBool::new(false),
            active_snippets: Mutex::new(HashMap::new()),
            listener_started: AtomicBool::new(false),
            #[cfg(target_os = "windows")]
            previous_hwnd: Mutex::new(0),
            is_expanding: AtomicBool::new(false),
        })
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            commands::set_focus_lock,
            commands::list_applications,
            commands::sync_application_index,
            commands::show,
            commands::hide,
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
            commands::write_binary_file_recursive,
            commands::write_text_file_absolute,
            commands::read_text_file_absolute,
            commands::mkdir_absolute,
            commands::spawn_headless_extension,
            commands::kill_extension,
            commands::fetch_url,
            commands::send_notification,
            commands::register_item_shortcut,
            commands::unregister_item_shortcut,
            commands::pause_user_shortcuts,
            commands::resume_user_shortcuts,
            commands::update_tray_menu,
            commands::get_current_platform,
            commands::expand_and_paste,
            commands::sync_snippets_to_rust,
            commands::set_snippets_enabled,
            commands::check_snippet_permission,
            commands::open_accessibility_preferences,
            permissions::register_extension_permissions,
            permissions::check_extension_permission,
            commands::export_profile,
            commands::import_profile,
            commands::show_save_profile_dialog,
            commands::show_open_profile_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    tray::setup_tray(app)?;

    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let handle = app.app_handle();
    let window = handle.get_webview_window(SPOTLIGHT_LABEL)
        .ok_or("Main launcher window not found")?;
    
    #[cfg(target_os = "macos")]
    let panel = crate::platform::macos::setup_spotlight_window(&window, handle)?;

    #[cfg(target_os = "windows")]
    let _ = crate::platform::windows::setup_spotlight_window(&window);

    #[cfg(target_os = "linux")]
    let _ = crate::platform::linux::setup_spotlight_window(&window);

    // Initialize the search state when the app starts
    let state = search_engine::initialize_search_state(app.handle())?;
    app.manage(state);

    // Setup panel event listener
    #[cfg(target_os = "macos")]
    {
        let handle_clone = handle.clone();
        handle.listen(
            format!("{}_panel_did_resign_key", SPOTLIGHT_LABEL),
            move |_| {
                let state = handle_clone.state::<AppState>();
                if !state.focus_locked.load(Ordering::Relaxed) {
                    state.asyar_visible.store(false, Ordering::Relaxed);
                    panel.order_out(None);
                }
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

