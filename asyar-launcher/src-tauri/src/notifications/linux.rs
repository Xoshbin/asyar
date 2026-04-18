//! Linux backend — `notify-rust` xdg driver.
//!
//! KDE and modern GNOME both honour action buttons; minimal daemons like
//! dunst support them too. We use `notify-rust` directly (instead of
//! going through tauri-plugin-notification, which strips actions) and
//! call `wait_for_action` in a spawned thread.

#![cfg(target_os = "linux")]

use crate::error::AppError;
use crate::notifications::backend::{ActionClickSink, NotificationBackend, NotificationRequest};
use log::{info, warn};

pub struct LinuxBackend {
    click_sink: ActionClickSink,
}

impl LinuxBackend {
    pub fn new(click_sink: ActionClickSink) -> Self {
        Self { click_sink }
    }
}

impl NotificationBackend for LinuxBackend {
    fn send(&self, request: NotificationRequest) -> Result<(), AppError> {
        if request.actions.is_empty() {
            send_plain(&request.title, &request.body);
            return Ok(());
        }

        let NotificationRequest { notification_id, title, body, actions, .. } = request;
        let sink = self.click_sink.clone();

        std::thread::spawn(move || {
            let mut n = notify_rust::Notification::new();
            n.summary(&title).body(&body);
            for a in &actions {
                // `action(identifier, label)` — identifier (first arg) is
                // what `wait_for_action` hands back, so we use the stable
                // action id verbatim.
                n.action(&a.id, &a.title);
            }

            let handle = match n.show() {
                Ok(h) => h,
                Err(e) => {
                    warn!("[notifications/linux] show failed for {}: {}", notification_id, e);
                    return;
                }
            };
            handle.wait_for_action(|action_id| match action_id {
                "__closed" => { /* user dismissed / system closed */ }
                other => {
                    info!("[notifications/linux] action '{}' clicked on {}", other, notification_id);
                    sink(&notification_id, other);
                }
            });
        });

        Ok(())
    }
}

fn send_plain(title: &str, body: &str) {
    let title = title.to_string();
    let body = body.to_string();
    std::thread::spawn(move || {
        if let Err(e) = notify_rust::Notification::new()
            .summary(&title)
            .body(&body)
            .show()
        {
            warn!("[notifications/linux] plain send failed: {}", e);
        }
    });
}
