//! macOS backend — `mac-notification-sys` driver.
//!
//! The Tauri plugin's desktop path (`notify-rust`) ignores action buttons
//! on macOS, so we call `mac_notification_sys` directly. Its `send()` is
//! synchronous and blocks the calling thread until the user interacts, so
//! we spawn a thread per notification-with-actions. Plain notifications
//! still use the fire-and-forget plugin path to keep complexity bounded.

#![cfg(target_os = "macos")]

use crate::error::AppError;
use crate::notifications::backend::{ActionClickSink, NotificationBackend, NotificationRequest};
use log::{info, warn};
use mac_notification_sys::{MainButton, NotificationResponse};
use std::collections::HashMap;
use std::sync::Once;

static APPLICATION_SET: Once = Once::new();

/// `mac-notification-sys` requires `set_application(bundle_id)` to be
/// called exactly once per process. tauri-plugin-notification also sets
/// this via `notify_rust::set_application` for its own notifications, but
/// we can't rely on the order — this `Once` guard is the single source
/// of truth on the notifications-with-actions path.
fn ensure_application_set() {
    APPLICATION_SET.call_once(|| {
        // Terminal's bundle id works in dev (unsigned); production installs
        // override it from the extension build step. Failure is non-fatal —
        // `send()` will just refuse to deliver if nothing is registered, and
        // that surfaces as a clean error rather than a silent drop.
        if let Err(e) = mac_notification_sys::set_application("com.apple.Terminal") {
            warn!("[notifications/macos] set_application failed: {e}");
        }
    });
}

pub struct MacOsBackend {
    click_sink: ActionClickSink,
}

impl MacOsBackend {
    pub fn new(click_sink: ActionClickSink) -> Self {
        Self { click_sink }
    }
}

impl NotificationBackend for MacOsBackend {
    fn send(&self, request: NotificationRequest) -> Result<(), AppError> {
        ensure_application_set();

        if request.actions.is_empty() {
            send_plain_async(&request.title, &request.body);
            return Ok(());
        }

        let NotificationRequest { notification_id, title, body, actions, .. } = request;
        let sink = self.click_sink.clone();

        // mac_notification_sys::send() blocks for user interaction. Spawn
        // off the calling thread so the Tauri command returns promptly.
        std::thread::spawn(move || {
            let label_to_id = build_label_to_id_map(&actions);

            let mut n = mac_notification_sys::Notification::new();
            n.title(&title).message(&body).close_button("Close");

            // Label borrows must live through send() so we build them in
            // this scope, not inside a helper.
            let dropdown_labels: Vec<&str>;
            match actions.len() {
                0 => {}
                1 => { n.main_button(MainButton::SingleAction(&actions[0].title)); }
                _ => {
                    dropdown_labels = actions.iter().map(|a| a.title.as_str()).collect();
                    n.main_button(MainButton::DropdownActions("Actions", &dropdown_labels));
                }
            }

            match n.send() {
                Ok(NotificationResponse::ActionButton(label)) => {
                    if let Some(action_id) = label_to_id.get(&label) {
                        info!("[notifications/macos] action '{}' clicked on {}", action_id, notification_id);
                        sink(&notification_id, action_id);
                    } else {
                        warn!(
                            "[notifications/macos] received unknown action label '{}' on {}",
                            label, notification_id
                        );
                    }
                }
                Ok(NotificationResponse::CloseButton(_))
                | Ok(NotificationResponse::None)
                | Ok(NotificationResponse::Click) => {
                    // User dismissed or clicked the body — no action.
                }
                Ok(NotificationResponse::Reply(_)) => {
                    // Reply input not currently exposed through the SDK; ignore.
                }
                Err(e) => {
                    warn!("[notifications/macos] send failed for {}: {}", notification_id, e);
                }
            }
        });

        Ok(())
    }
}

fn send_plain_async(title: &str, body: &str) {
    let title = title.to_string();
    let body = body.to_string();
    std::thread::spawn(move || {
        let result = mac_notification_sys::Notification::new()
            .title(&title)
            .message(&body)
            .asynchronous(true)
            .send();
        if let Err(e) = result {
            warn!("[notifications/macos] plain send failed: {}", e);
        }
    });
}

fn build_label_to_id_map(actions: &[crate::notifications::backend::BackendAction]) -> HashMap<String, String> {
    actions
        .iter()
        .map(|a| (a.title.clone(), a.id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::backend::BackendAction;

    fn ba(id: &str, title: &str) -> BackendAction {
        BackendAction {
            id: id.to_string(),
            title: title.to_string(),
            command_id: "cmd".to_string(),
            args_json: None,
        }
    }

    #[test]
    fn label_to_id_round_trips_titles_back_to_ids() {
        let actions = vec![ba("extend", "Extend 30m"), ba("stop", "Stop now")];
        let map = build_label_to_id_map(&actions);
        assert_eq!(map.get("Extend 30m"), Some(&"extend".to_string()));
        assert_eq!(map.get("Stop now"), Some(&"stop".to_string()));
    }

}
