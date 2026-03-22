use tauri::{Listener, Manager, Emitter};

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

pub struct AppState {
    pub focus_locked: AtomicBool,
    pub user_shortcuts: Mutex<HashMap<String, String>>,
    pub launcher_shortcut: Mutex<String>,
}

use tauri_nspanel::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use window::WebviewWindowExt;
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

pub mod command;
pub mod tray;
pub mod window;
mod search_engine;

pub const SPOTLIGHT_LABEL: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .plugin(tauri_nspanel::init())
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
            // 1. Built-in (Resources)
            // 2. Installed (AppData)
            // 3. Dev source (only in debug)
            
            let mut final_path = None;

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
                    let is_allowed = is_path_allowed(&canonical_path, &handle);

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
                        .header("Content-Security-Policy", "default-src asyar-extension: 'self'; script-src asyar-extension: 'unsafe-inline' 'unsafe-eval'; style-src asyar-extension: 'unsafe-inline'; font-src asyar-extension:; img-src asyar-extension: data:;")
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
        // Use the global shortcut plugin with a handler
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
                        let panel = app.get_webview_panel(SPOTLIGHT_LABEL).unwrap();

                        if panel.is_visible() {
                            panel.order_out(None);
                        } else {
                            let _ = window.center_at_cursor_monitor();
                            panel.show();
                        }
                    }
                })
                .build(),
        )
        .manage(command::ExtensionRegistry(Mutex::new(HashMap::new())))
        .manage(AppState { 
            focus_locked: AtomicBool::new(false),
            user_shortcuts: Mutex::new(HashMap::new()),
            launcher_shortcut: Mutex::new(String::from("Super+K")),
        })
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            command::set_focus_lock,
            command::list_applications,
            command::show,
            command::hide,
            command::simulate_paste,
            command::update_global_shortcut,
            command::get_persisted_shortcut,
            command::initialize_shortcut_from_settings,
            command::initialize_autostart_from_settings,
            command::get_autostart_status,
            command::delete_extension_directory,
            command::check_path_exists,
            command::uninstall_extension,
            command::install_extension_from_url, 
            command::get_extensions_dir, // Added new command
            command::list_installed_extensions, // Added new command
            command::get_builtin_extensions_path, // Added new command
            search_engine::commands::index_item,
            search_engine::commands::search_items,
            search_engine::commands::get_indexed_object_ids,
            search_engine::commands::delete_item,
            search_engine::commands::reset_search_index,
            search_engine::commands::record_item_usage,
            command::write_binary_file_recursive,
            command::write_text_file_absolute,
            command::read_text_file_absolute,
            command::mkdir_absolute,
            command::spawn_headless_extension,
            command::kill_extension,
            command::fetch_url,
            command::send_notification,
            command::register_item_shortcut,
            command::unregister_item_shortcut,
            command::pause_user_shortcuts,
            command::resume_user_shortcuts,
            command::update_tray_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    tray::setup_tray(app)?;

    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let handle = app.app_handle();
    let window = handle.get_webview_window(SPOTLIGHT_LABEL).unwrap();
    let panel = window.to_spotlight_panel()?;

    // **** Log the path HERE ****
    let index_path_result = handle.path().app_data_dir().map(|p| p.join("search_index"));
    match &index_path_result {
       Ok(path) => log::info!("EXPECTED INDEX PATH: {}", path.display()),
       Err(e) => log::error!("Failed to determine index path: {}", e),
    }
    // ***************************

    // Initialize the search state when the app starts
    let state = search_engine::initialize_search_state(&app.handle())?;
    app.manage(state);

    // Setup panel event listener
    let handle_clone = handle.clone();
    handle.listen(
        format!("{}_panel_did_resign_key", SPOTLIGHT_LABEL),
        move |_| {
            let state = handle_clone.state::<AppState>();
            if !state.focus_locked.load(Ordering::Relaxed) {
                panel.order_out(None);
            }
        },
    );

    #[cfg(target_os = "macos")]
    apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, Some(12.0))
        .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");

    #[cfg(target_os = "windows")]
    apply_blur(&window, Some((18, 18, 18, 125)))
        .expect("Unsupported platform! 'apply_blur' is only supported on Windows");

    // Setup global shortcut with default configuration
    setup_global_shortcut(&handle);

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
        println!(
            "current autostart status: {}",
            autostart_manager.is_enabled().unwrap_or(false)
        );
    }

    Ok(())
}

fn setup_global_shortcut(app_handle: &tauri::AppHandle) {
    // Use default shortcut configuration initially
    let shortcut_config = command::ShortcutConfig::default();

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

    let code = match command::get_code_from_string(&shortcut_config.key) {
        Ok(code) => code,
        Err(_) => Code::KeyK, // Default to KeyK if invalid
    };

    // Register the shortcut without a handler (it will be handled by the global handler)
    let shortcut = Shortcut::new(Some(mod_key), code);

    // Register the shortcut
    if let Err(e) = shortcut_manager.register(shortcut) {
        eprintln!("Failed to register shortcut: {}", e);
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
    if let Some(home_dir) = dirs::home_dir() {
        if path.starts_with(&home_dir) {
            return true;
        }
    }

    // Allow 4: Debug builds only — allow any path for development flexibility
    #[cfg(debug_assertions)]
    {
        return true;
    }

    #[cfg(not(debug_assertions))]
    false
}
