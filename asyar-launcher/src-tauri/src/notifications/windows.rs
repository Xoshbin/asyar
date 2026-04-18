//! Windows backend — plain notifications via tauri-plugin-notification.
//!
//! Toast actions aren't surfaced by the Tauri plugin on Windows yet, and
//! writing a Win32-native action path isn't in scope here. When an
//! extension supplies `actions`, we fire the notification without
//! buttons and log a warning so it's visible in development.

#![cfg(target_os = "windows")]

use crate::error::AppError;
use crate::notifications::backend::{ActionClickSink, NotificationBackend, NotificationRequest};
use log::warn;
use tauri::{AppHandle, Runtime};
use tauri_plugin_notification::NotificationExt;

pub struct WindowsBackend<R: Runtime> {
    app: AppHandle<R>,
    _click_sink: ActionClickSink,
}

impl<R: Runtime> WindowsBackend<R> {
    pub fn new(app: AppHandle<R>, click_sink: ActionClickSink) -> Self {
        Self { app, _click_sink: click_sink }
    }
}

impl<R: Runtime> NotificationBackend for WindowsBackend<R> {
    fn send(&self, request: NotificationRequest) -> Result<(), AppError> {
        if !request.actions.is_empty() {
            warn!(
                "[notifications/windows] {} action(s) on '{}' silently dropped — toast actions not supported on this platform yet",
                request.actions.len(),
                request.notification_id
            );
        }

        self.app
            .notification()
            .builder()
            .title(&request.title)
            .body(&request.body)
            .show()
            .map_err(|e| AppError::Platform(format!("notification send: {}", e)))?;
        Ok(())
    }
}
