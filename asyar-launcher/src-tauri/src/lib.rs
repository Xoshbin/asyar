use tauri::{Manager, Emitter};

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
}

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
pub mod commands;
pub mod tray;
pub mod platform;
pub mod error;
mod search_engine;
mod snippets;

pub const SPOTLIGHT_LABEL: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .register_uri_scheme_protocol("asyar-extension", |app, request| {
            let uri = request.uri().to_string();
            let path = if uri.starts_with("asyar-extension://localhost/") {
                uri.strip_prefix("asyar-extension://localhost/").unwrap()
            } else if uri.starts_with("asyar-extension://") {
                uri.strip_prefix("asyar-extension://").unwrap()
            } else if uri.starts_with("http://asyar-extension.localhost/") {
                uri.strip_prefix("http://asyar-extension.localhost/").unwrap()
            } else {
                &uri
            };
            
            // Expected format: asyar-extension://[localhost/]{extension_id}/{file_path}
            let mut parts = path.splitn(2, '/');
            let extension_id = parts.next().unwrap_or("");
            let encoded_file_path = parts.next().unwrap_or("index.html");
            
            // [ARCHITECTURE SAFEGUARD]: LOCAL FILE RESOLUTION
            // Strip any query parameters (?foo=bar) or URL fragments (#baz) from the requested file path.
            // When iframes load URLs (e.g. `asyar-extension://xyz/index.html?view=DefaultView`), 
            // the parameters are part of the raw HTTP request. If we do not strip them here,
            // the Rust `std::fs` backend will look for a literal file on disk named "index.html?view=DefaultView" 
            // and fail with File Not Found, breaking installed extension iframes entirely.
            let file_path = encoded_file_path.split('?').next().unwrap_or(encoded_file_path).split('#').next().unwrap_or(encoded_file_path);

            let handle = app.app_handle();
            let app_data_dir = handle.path().app_data_dir().unwrap_or_default();
            let resource_dir = handle.path().resource_dir().unwrap_or_default();

            // Fallback Chain:
            // 0. Dev Registry (dev_extensions.json)
            // 1. Built-in (Resources)
            // 2. Installed (AppData)
            // 3. Dev source (only in debug)
            
            let mut final_path = None;

            // Priority 0: Dev Registry Paths
            let dev_registry_file = app_data_dir.join("dev_extensions.json");
            if dev_registry_file.exists() {
                if let Ok(content) = std::fs::read_to_string(&dev_registry_file) {
                    if let Ok(dev_extensions) = serde_json::from_str::<std::collections::HashMap<String, String>>(&content) {
                        if let Some(base_path) = dev_extensions.get(extension_id) {
                            let possible_paths = vec![
                                std::path::PathBuf::from(base_path).join("dist").join(file_path),
                                std::path::PathBuf::from(base_path).join(file_path),
                            ];
                            for p in possible_paths {
                                if p.exists() && p.is_file() {
                                    final_path = Some(p);
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Priority 1: Fallback for development (fresh build output) - only in debug
            #[cfg(debug_assertions)]
            {
                let dev_base = std::env::current_dir().unwrap_or_default()
                    .join("src/built-in-extensions")
                    .join(extension_id)
                    .join("dist");
                
                let mut dev_path = dev_base.join(file_path);
                
                // If index.css is requested specifically but doesn't exist, try to find ANY .css file
                if file_path == "index.css" && !dev_path.exists() {
                    if let Ok(entries) = std::fs::read_dir(&dev_base) {
                        for entry in entries.flatten() {
                            if entry.path().extension().and_then(|s| s.to_str()) == Some("css") {
                                dev_path = entry.path();
                                break;
                            }
                        }
                    }
                }

                if dev_path.exists() && dev_path.is_file() {
                    final_path = Some(dev_path);
                }
            }

            if final_path.is_none() {
                // Priority 2: Built-in (Bundled Resources)
                let resource_path = resource_dir.join("built-in-extensions").join(extension_id).join(file_path);
                if resource_path.exists() && resource_path.is_file() {
                    final_path = Some(resource_path);
                }
            }

            if final_path.is_none() {
                // Priority 3: Installed (AppData)
                let possible_paths = vec![
                    app_data_dir.join("extensions").join(extension_id).join("dist").join(file_path),
                    app_data_dir.join("extensions").join(extension_id).join(file_path),
                ];

                for p in possible_paths {
                    if p.exists() && p.is_file() {
                        final_path = Some(p);
                        break;
                    }
                }
            }

            match final_path {
                Some(resolved_path) => {
                    // Step 1: Canonicalize to resolve any symlinks
                    let canonical_path = match std::fs::canonicalize(&resolved_path) {
                        Ok(p) => p,
                        Err(_) => {
                            // Path doesn't exist or can't be resolved
                            return tauri::http::Response::builder()
                                .status(404)
                                .body(Vec::new())
                                .unwrap();
                        }
                    };

                    // Step 2: Validate the canonical path is in an allowed location
                    let is_allowed = is_path_allowed(&canonical_path, handle);

                    if !is_allowed {
                        return tauri::http::Response::builder()
                            .status(403)
                            .body(b"Access denied".to_vec())
                            .unwrap();
                    }

                    // Step 3: Read from the canonical (real) path
                    let content = match std::fs::read(&canonical_path) {
                        Ok(bytes) => bytes,
                        Err(_) => {
                            return tauri::http::Response::builder()
                                .status(404)
                                .body(b"File not found".to_vec())
                                .unwrap();
                        }
                    };

                    let mime_type = match canonical_path.extension().and_then(|e| e.to_str()) {
                        Some("html") => "text/html",
                        Some("js") => "application/javascript",
                        Some("css") => "text/css",
                        Some("png") => "image/png",
                        Some("svg") => "image/svg+xml",
                        Some("json") => "application/json",
                        _ => "text/plain",
                    };

                    tauri::http::Response::builder()
                        .header("Content-Type", mime_type)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Content-Security-Policy", "default-src asyar-extension: 'self'; script-src asyar-extension: 'self' 'unsafe-inline' 'unsafe-eval'; style-src asyar-extension: 'self' 'unsafe-inline'; font-src asyar-extension: 'self'; img-src asyar-extension: 'self' data:;")
                        .body(content)
                        .unwrap()
                }
                None => {
                    tauri::http::Response::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap()
                }
            }
        })
        .register_uri_scheme_protocol("asyar-icon", |app, request| {
            let uri = request.uri().to_string();
            log::debug!("Icon request URI: {}", uri);
            let mut path = if uri.starts_with("asyar-icon://localhost/") {
                uri.strip_prefix("asyar-icon://localhost/").unwrap()
            } else if uri.starts_with("asyar-icon://") {
                uri.strip_prefix("asyar-icon://").unwrap()
            } else {
                &uri
            };

            // Trim trailing slash if present (often added by webview for host-only URIs)
            if path.ends_with('/') {
                path = &path[..path.len() - 1];
            }

            let handle = app.app_handle();
            let icon_cache_dir = handle.path().app_data_dir()
                .map(|p| p.join("icon_cache"))
                .unwrap_or_default();

            // Strip any query parameters or fragments
            let filename = path.split('?').next().unwrap_or(path).split('#').next().unwrap_or(path);
            let file_path = icon_cache_dir.join(filename);
            log::debug!("Icon resolved path: {:?}", file_path);

            // Security: Ensure the file is inside the icon_cache_dir
            if !file_path.starts_with(&icon_cache_dir) {
                log::warn!("Icon security violation: {:?} not in {:?}", file_path, icon_cache_dir);
                return tauri::http::Response::builder()
                    .status(403)
                    .body(Vec::new())
                    .unwrap();
            }

            match std::fs::read(&file_path) {
                Ok(bytes) => {
                    tauri::http::Response::builder()
                        .header("Content-Type", "image/png")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(bytes)
                        .unwrap()
                }
                Err(_) => {
                    tauri::http::Response::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap()
                }
            }
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let state = app.state::<AppState>();
                        
                        let mut canonical_parts = Vec::new();
                        let mods = shortcut.mods;
                        if mods.contains(Modifiers::SUPER) { canonical_parts.push("Super"); }
                        if mods.contains(Modifiers::CONTROL) { canonical_parts.push("Control"); }
                        if mods.contains(Modifiers::ALT) { canonical_parts.push("Alt"); }
                        if mods.contains(Modifiers::SHIFT) { canonical_parts.push("Shift"); }
                        
                        let key_str = match shortcut.key {
                            Code::KeyA => "A", Code::KeyB => "B", Code::KeyC => "C", Code::KeyD => "D",
                            Code::KeyE => "E", Code::KeyF => "F", Code::KeyG => "G", Code::KeyH => "H",
                            Code::KeyI => "I", Code::KeyJ => "J", Code::KeyK => "K", Code::KeyL => "L",
                            Code::KeyM => "M", Code::KeyN => "N", Code::KeyO => "O", Code::KeyP => "P",
                            Code::KeyQ => "Q", Code::KeyR => "R", Code::KeyS => "S", Code::KeyT => "T",
                            Code::KeyU => "U", Code::KeyV => "V", Code::KeyW => "W", Code::KeyX => "X",
                            Code::KeyY => "Y", Code::KeyZ => "Z",
                            Code::Digit0 => "0", Code::Digit1 => "1", Code::Digit2 => "2", Code::Digit3 => "3",
                            Code::Digit4 => "4", Code::Digit5 => "5", Code::Digit6 => "6", Code::Digit7 => "7",
                            Code::Digit8 => "8", Code::Digit9 => "9",
                            Code::F1 => "F1", Code::F2 => "F2", Code::F3 => "F3", Code::F4 => "F4",
                            Code::F5 => "F5", Code::F6 => "F6", Code::F7 => "F7", Code::F8 => "F8",
                            Code::F9 => "F9", Code::F10 => "F10", Code::F11 => "F11", Code::F12 => "F12",
                            Code::Space => "Space",
                            _ => "",
                        };
                        
                        if !key_str.is_empty() {
                            canonical_parts.push(key_str);
                        }
                        let canonical = canonical_parts.join("+");

                        if let Ok(user_shortcuts) = state.user_shortcuts.lock() {
                            if let Some(object_id) = user_shortcuts.get(&canonical) {
                                let _ = app.emit("user-shortcut-fired", object_id.clone());
                                return;
                            }
                        }

                        let window = app.get_webview_window(SPOTLIGHT_LABEL).unwrap();

                        #[cfg(target_os = "macos")]
                        {
                            use tauri_nspanel::ManagerExt;
                            let panel = app.get_webview_panel(SPOTLIGHT_LABEL).unwrap();
                            if panel.is_visible() {
                                state.asyar_visible.store(false, Ordering::Relaxed);
                                panel.order_out(None);
                            } else {
                                state.asyar_visible.store(true, Ordering::Relaxed);
                                let _ = crate::platform::macos::center_at_cursor_monitor(&window);
                                panel.show();
                            }
                        }

                        #[cfg(not(target_os = "macos"))]
                        {
                            if window.is_visible().unwrap_or(false) {
                                state.asyar_visible.store(false, Ordering::Relaxed);
                                let _ = window.hide();
                                #[cfg(target_os = "windows")]
                                {
                                    let prev = *state.previous_hwnd.lock().unwrap();
                                    crate::platform::windows::restore_foreground_window(prev);
                                }
                            } else {
                                #[cfg(target_os = "windows")]
                                {
                                    let prev = crate::platform::windows::capture_foreground_window();
                                    *state.previous_hwnd.lock().unwrap() = prev;
                                }
                                state.asyar_visible.store(true, Ordering::Relaxed);
                                #[cfg(target_os = "windows")]
                                let _ = crate::platform::windows::setup_spotlight_window(&window);
                                #[cfg(target_os = "linux")]
                                let _ = crate::platform::linux::setup_spotlight_window(&window);
                                
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
        .manage(commands::ExtensionRegistry(Mutex::new(HashMap::new())))
        .manage(AppState { 
            focus_locked: AtomicBool::new(false),
            user_shortcuts: Mutex::new(HashMap::new()),
            launcher_shortcut: Mutex::new(String::from("Super+K")),
            snippets_enabled: AtomicBool::new(false),
            asyar_visible: AtomicBool::new(false),
            active_snippets: Mutex::new(HashMap::new()),
            listener_started: AtomicBool::new(false),
            #[cfg(target_os = "windows")]
            previous_hwnd: Mutex::new(0),
        })
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            commands::set_focus_lock,
            commands::list_applications,
            commands::show,
            commands::hide,
            commands::simulate_paste,
            commands::update_global_shortcut,
            commands::get_persisted_shortcut,
            commands::initialize_shortcut_from_settings,
            commands::initialize_autostart_from_settings,
            commands::get_autostart_status,
            commands::delete_extension_directory,
            commands::check_path_exists,
            commands::uninstall_extension,
            commands::install_extension_from_url, 
            commands::open_application_path,
            commands::get_extensions_dir,
            commands::list_installed_extensions,
            commands::get_builtin_extensions_path,
            commands::register_dev_extension,
            commands::get_dev_extension_paths,
            search_engine::commands::index_item,
            search_engine::commands::batch_index_items,
            search_engine::commands::save_search_index,
            search_engine::commands::search_items,
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
            commands::expand_and_paste,
            commands::sync_snippets_to_rust,
            commands::set_snippets_enabled,
            commands::check_snippet_permission,
            commands::open_accessibility_preferences,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    tray::setup_tray(app)?;

    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let handle = app.app_handle();
    let window = handle.get_webview_window(SPOTLIGHT_LABEL).unwrap();
    
    #[cfg(target_os = "macos")]
    let panel = crate::platform::macos::setup_spotlight_window(&window, handle)?;

    #[cfg(target_os = "windows")]
    let _ = crate::platform::windows::setup_spotlight_window(&window);

    #[cfg(target_os = "linux")]
    let _ = crate::platform::linux::setup_spotlight_window(&window);

    // **** Log the path HERE ****
    let index_path_result = handle.path().app_data_dir().map(|p| p.join("search_index"));
    match &index_path_result {
       Ok(path) => log::info!("EXPECTED INDEX PATH: {}", path.display()),
       Err(e) => log::error!("Failed to determine index path: {}", e),
    }
    // ***************************

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
        _ => Modifiers::SUPER, // Default to SUPER if invalid
    };

    let code = match commands::get_code_from_string(&shortcut_config.key) {
        Ok(code) => code,
        Err(_) => Code::KeyK, // Default to KeyK if invalid
    };

    // Register the shortcut without a handler (it will be handled by the global handler)
    let shortcut = Shortcut::new(Some(mod_key), code);

    // Register the shortcut
    if let Err(e) = shortcut_manager.register(shortcut) {
        log::error!("Failed to register shortcut: {}", e);
    }
}

fn is_path_allowed(path: &std::path::Path, app: &tauri::AppHandle) -> bool {
    // Allow 1: Path is inside the app's extensions directory
    if let Ok(extensions_dir) = app.path().app_data_dir().map(|p| p.join("extensions")) {
        if path.starts_with(&extensions_dir) {
            return true;
        }
    }

    // Allow 2: Path is inside the app's local data extensions directory (Windows)
    if let Ok(local_extensions_dir) = app.path().app_local_data_dir().map(|p| p.join("extensions")) {
        if path.starts_with(&local_extensions_dir) {
            return true;
        }
    }

    // Allow 3: Path is inside the user's home directory
    // This covers developer symlink targets like ~/develop/extensions/my-ext/
    #[cfg(debug_assertions)]
    if let Some(home_dir) = dirs::home_dir() {
        if path.starts_with(&home_dir) {
            return true;
        }
    }

    // Allow 4: Debug builds only — allow any path for development flexibility
    #[cfg(debug_assertions)]
    {
        true
    }

    #[cfg(not(debug_assertions))]
    false
}
