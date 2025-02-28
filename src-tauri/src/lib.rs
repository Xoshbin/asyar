use tauri::plugin::Plugin;
use tauri::{Listener, Manager};
use tauri_nspanel::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use window::WebviewWindowExt;

pub mod command;
pub mod tray;
pub mod window;

pub const SPOTLIGHT_LABEL: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_nspanel::init())
        // Use the global shortcut plugin with a handler
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
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
                .build()
        )
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            command::list_applications,
            command::show,
            command::hide,
            command::simulate_paste,
            command::update_global_shortcut,
            command::get_shortcut_config,
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

    // Setup panel event listener
    handle.listen(
        format!("{}_panel_did_resign_key", SPOTLIGHT_LABEL),
        move |_| {
            panel.order_out(None);
        },
    );

    // Setup global shortcut from stored config
    setup_global_shortcut(&handle);

    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::MacosLauncher;
        use tauri_plugin_autostart::ManagerExt;

        let _ = app.handle().plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--flag1", "--flag2"]),
        ));

        // Get the autostart manager
        let autostart_manager = app.autolaunch();
        // Enable autostart
        let _ = autostart_manager.enable();
        // Check enable state
        println!(
            "registered for autostart? {}",
            autostart_manager.is_enabled().unwrap()
        );
        // Disable autostart
        let _ = autostart_manager.disable();
    }

    Ok(())
}

fn setup_global_shortcut(app_handle: &tauri::AppHandle) {
    // Create a runtime to run the async function
    let rt = tokio::runtime::Runtime::new().unwrap();
    
    // Load shortcut configuration
    let shortcut_config = match rt.block_on(command::load_shortcut_config(app_handle)) {
        Ok(config) => config,
        Err(e) => {
            eprintln!("Failed to load shortcut config: {}, using default", e);
            command::ShortcutConfig::default()
        }
    };
    
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
