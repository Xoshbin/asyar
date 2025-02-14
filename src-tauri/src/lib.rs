//! Main application setup and configuration module.
//!
//! This module contains the core functionality for setting up the Tauri application,
//! including window management, plugin configuration, and global shortcuts.
//! The panel can be toggled using CMD+K (Super+K) keyboard shortcut.
//!
//! # Constants
//! - `SPOTLIGHT_LABEL`: Label for the main spotlight window
//! - `SETTINGS_LABEL`: Label for the settings window
//!
//! # Features
//! - Single instance application
//! - Autostart capability 
//! - Global shortcuts
//! - System tray integration
//! - Clipboard management
//! - Persistent storage
//! - NSPanel integration for macOS
//!
//! # Key Components
//! - `create_app()`: Creates and configures the main Tauri application builder
//! - `setup_app()`: Handles initial application setup including tray and window configuration
//! - `setup_desktop_features()`: Configures desktop-specific features like autostart
//! - `create_shortcut_plugin()`: Sets up global shortcuts (CMD+K/Super+K for panel toggle)
use tauri::{Builder, Listener, Manager, Wry};
use tauri::plugin::Plugin;
use tauri_nspanel::ManagerExt;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use window::WebviewWindowExt;

pub mod command;
pub mod window;
pub mod tray;

pub const SPOTLIGHT_LABEL: &str = "main";
pub const SETTINGS_LABEL: &str = "settings";

// Change from generic Runtime to specific Wry runtime
pub fn create_app() -> Builder<Wry> {
    Builder::<Wry>::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--flag1", "--flag2"]),
        ))
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            command::show,
            command::hide,
            command::simulate_paste,
            command::list_applications
        ])
        .plugin(tauri_nspanel::init())
        .setup(setup_app)
        .plugin(create_shortcut_plugin())
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    tray::setup_tray(app)?;

    #[cfg(desktop)]
    setup_desktop_features(app);

    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let handle = app.app_handle();
    let window = handle.get_webview_window(SPOTLIGHT_LABEL).unwrap();
    let panel = window.to_spotlight_panel()?;

    handle.listen(
        format!("{}_panel_did_resign_key", SPOTLIGHT_LABEL),
        move |_| {
            panel.order_out(None);
        },
    );

    Ok(())
}

#[cfg(desktop)]
fn setup_desktop_features(app: &tauri::App) {
    use tauri_plugin_autostart::ManagerExt;

    let autostart_manager = app.autolaunch();
    let _ = autostart_manager.enable();
    println!(
        "registered for autostart? {}",
        autostart_manager.is_enabled().unwrap()
    );
    let _ = autostart_manager.disable();
}

// cmd+k to toggle the panel
fn create_shortcut_plugin() -> impl Plugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_shortcut(Shortcut::new(Some(Modifiers::SUPER), Code::KeyK))
        .unwrap()
        .with_handler(|app, shortcut, event| {
            if event.state == ShortcutState::Pressed
                && shortcut.matches(Modifiers::SUPER, Code::KeyK)
            {
                let window = app.get_webview_window(SPOTLIGHT_LABEL).unwrap();
                let panel = app.get_webview_panel(SPOTLIGHT_LABEL).unwrap();

                if panel.is_visible() {
                    panel.order_out(None);
                } else {
                    window.center_at_cursor_monitor().unwrap();
                    panel.show();
                }
            }
        })
        .build()
}
