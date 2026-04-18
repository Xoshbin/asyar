//! Desktop notification subsystem.
//!
//! Extensions call `notifications:send` with optional action buttons;
//! the registry tracks the `{extension_id, command_id, args}` target
//! behind each (`notification_id`, `action_id`) pair. When the OS
//! reports a click the dispatcher looks the target up and emits
//! `asyar:notification-action`, which a TS bridge forwards to the same
//! `handleCommandAction` path a search-result click would take.

pub mod backend;
pub mod commands;
pub mod dispatch;
pub mod registry;
pub mod scheduler;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

pub use backend::{BackendAction, NotificationBackend, NotificationRequest};
pub use dispatch::{resolve_click, NotificationActionEvent};
pub use registry::{NotificationActionRegistry, PendingAction, DEFAULT_TTL};

/// Tauri event name emitted when a notification action is clicked.
pub const NOTIFICATION_ACTION_EVENT: &str = "asyar:notification-action";

use std::sync::Arc;

/// Build the platform-appropriate backend, wiring the click sink through
/// `AppHandle::emit` so TS bridges see the `asyar:notification-action`
/// event with a fully-resolved `{extensionId, commandId, argsJson}`.
pub fn build_default_backend<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    registry: Arc<NotificationActionRegistry>,
) -> Arc<dyn NotificationBackend> {
    use tauri::Emitter;

    let registry_for_sink = Arc::clone(&registry);
    let app_for_sink = app.clone();
    let click_sink: backend::ActionClickSink = Arc::new(move |notification_id: &str, action_id: &str| {
        match resolve_click(&registry_for_sink, notification_id, action_id) {
            Some(event) => {
                if let Err(e) = app_for_sink.emit(NOTIFICATION_ACTION_EVENT, &event) {
                    log::warn!(
                        "[notifications] failed to emit {}: {}",
                        NOTIFICATION_ACTION_EVENT,
                        e
                    );
                }
                // Each notification's actions are one-shot: the OS closes
                // the notification on click, so drop the whole group.
                registry_for_sink.remove(notification_id);
            }
            None => {
                log::warn!(
                    "[notifications] received click for unknown ({},{}) — extension likely disabled",
                    notification_id,
                    action_id
                );
            }
        }
    });

    #[cfg(target_os = "macos")]
    {
        let _ = app;
        Arc::new(macos::MacOsBackend::new(click_sink))
    }
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        Arc::new(linux::LinuxBackend::new(click_sink))
    }
    #[cfg(target_os = "windows")]
    {
        Arc::new(windows::WindowsBackend::new(app, click_sink))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        compile_error!("unsupported platform for notifications backend");
    }
}
