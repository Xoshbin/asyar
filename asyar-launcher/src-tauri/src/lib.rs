use tauri::plugin::Plugin;
use tauri::{Listener, Manager};
use tauri_nspanel::ManagerExt;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use window::WebviewWindowExt;

pub mod command;
pub mod tray;
pub mod window;

pub const SPOTLIGHT_LABEL: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_nspanel::init())
        .plugin(create_shortcut_plugin())
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            command::list_applications,
            command::show,
            command::hide,
            command::simulate_paste,
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

    handle.listen(
        format!("{}_panel_did_resign_key", SPOTLIGHT_LABEL),
        move |_| {
            panel.order_out(None);
        },
    );

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
        println!("registered for autostart? {}", autostart_manager.is_enabled().unwrap());
        // Disable autostart
        let _ = autostart_manager.disable();
    }

    Ok(())
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
