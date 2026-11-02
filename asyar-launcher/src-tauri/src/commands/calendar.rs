//! Tauri command layer for native calendar and reminders access.
//!
//! Thin wrappers delegating to pure `*_inner` functions so the permission
//! gates are unit testable without a running Tauri app. Four granular
//! permissions apply: `calendar:read`, `calendar:write`, `reminders:read` and
//! `reminders:write`.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use asyar_platform::{
    AccessKind, AccessState, CalendarEvent, CalendarSource, CreateEventInput, CreateReminderInput,
    ReminderItem, ReminderList,
};
use tauri::State;

const CALENDAR_READ: &str = "calendar:read";
const CALENDAR_WRITE: &str = "calendar:write";
const REMINDERS_READ: &str = "reminders:read";
const REMINDERS_WRITE: &str = "reminders:write";

fn platform_err(e: asyar_platform::PlatformError) -> AppError {
    AppError::Platform(e.to_string())
}

// EventKit calls block (permission prompt, reminders fetch), so every command
// runs on the async runtime's pool rather than the main thread.
#[tauri::command(async)]
pub fn calendar_list_calendars(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
) -> Result<Vec<CalendarSource>, AppError> {
    calendar_list_calendars_inner(&permissions, extension_id)
}

#[tauri::command(async)]
pub fn calendar_list_events(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    start_at: i64,
    end_at: i64,
    calendar_ids: Option<Vec<String>>,
) -> Result<Vec<CalendarEvent>, AppError> {
    calendar_list_events_inner(&permissions, extension_id, start_at, end_at, calendar_ids)
}

#[tauri::command(async)]
pub fn calendar_create_event(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    input: CreateEventInput,
) -> Result<CalendarEvent, AppError> {
    calendar_create_event_inner(&permissions, extension_id, input)
}

#[tauri::command(async)]
pub fn calendar_list_reminder_lists(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
) -> Result<Vec<ReminderList>, AppError> {
    calendar_list_reminder_lists_inner(&permissions, extension_id)
}

#[tauri::command(async)]
pub fn calendar_list_reminders(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    list_ids: Option<Vec<String>>,
    include_completed: Option<bool>,
) -> Result<Vec<ReminderItem>, AppError> {
    calendar_list_reminders_inner(&permissions, extension_id, list_ids, include_completed)
}

#[tauri::command(async)]
pub fn calendar_create_reminder(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    input: CreateReminderInput,
) -> Result<ReminderItem, AppError> {
    calendar_create_reminder_inner(&permissions, extension_id, input)
}

#[tauri::command(async)]
pub fn calendar_set_reminder_completed(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    id: String,
    completed: bool,
) -> Result<ReminderItem, AppError> {
    calendar_set_reminder_completed_inner(&permissions, extension_id, id, completed)
}

/// Host-only (not in the `asyar:api:*` permission table): drives the
/// Settings → Privacy permissions card, so extensions cannot reach it.
#[tauri::command(async)]
pub fn calendar_access_status(kind: AccessKind) -> Result<AccessState, AppError> {
    asyar_platform::access_status(kind).map_err(platform_err)
}

/// Host-only: shows the macOS prompt when the decision is still open.
#[tauri::command(async)]
pub fn calendar_request_access(kind: AccessKind) -> Result<AccessState, AppError> {
    asyar_platform::request_access(kind).map_err(platform_err)
}

pub(crate) fn calendar_list_calendars_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
) -> Result<Vec<CalendarSource>, AppError> {
    permissions.check(&extension_id, CALENDAR_READ)?;
    asyar_platform::list_calendars().map_err(platform_err)
}

pub(crate) fn calendar_list_events_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    start_at: i64,
    end_at: i64,
    calendar_ids: Option<Vec<String>>,
) -> Result<Vec<CalendarEvent>, AppError> {
    permissions.check(&extension_id, CALENDAR_READ)?;
    asyar_platform::list_events(start_at, end_at, calendar_ids.as_deref()).map_err(platform_err)
}

pub(crate) fn calendar_create_event_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    input: CreateEventInput,
) -> Result<CalendarEvent, AppError> {
    permissions.check(&extension_id, CALENDAR_WRITE)?;
    asyar_platform::create_event(input).map_err(platform_err)
}

pub(crate) fn calendar_list_reminder_lists_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
) -> Result<Vec<ReminderList>, AppError> {
    permissions.check(&extension_id, REMINDERS_READ)?;
    asyar_platform::list_reminder_lists().map_err(platform_err)
}

pub(crate) fn calendar_list_reminders_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    list_ids: Option<Vec<String>>,
    include_completed: Option<bool>,
) -> Result<Vec<ReminderItem>, AppError> {
    permissions.check(&extension_id, REMINDERS_READ)?;
    asyar_platform::list_reminders(list_ids.as_deref(), include_completed.unwrap_or(false))
        .map_err(platform_err)
}

pub(crate) fn calendar_create_reminder_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    input: CreateReminderInput,
) -> Result<ReminderItem, AppError> {
    permissions.check(&extension_id, REMINDERS_WRITE)?;
    asyar_platform::create_reminder(input).map_err(platform_err)
}

pub(crate) fn calendar_set_reminder_completed_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    id: String,
    completed: bool,
) -> Result<ReminderItem, AppError> {
    permissions.check(&extension_id, REMINDERS_WRITE)?;
    asyar_platform::set_reminder_completed(&id, completed).map_err(platform_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn registered(ext_id: &str, perms: &[&str]) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let set: HashSet<String> = perms.iter().map(|p| p.to_string()).collect();
        reg.inner.lock().unwrap().insert(ext_id.to_string(), set);
        reg
    }

    fn ext() -> Option<String> {
        Some("ext-a".to_string())
    }

    fn is_permission_denied<T: std::fmt::Debug>(r: &Result<T, AppError>) -> bool {
        matches!(r, Err(AppError::Permission(_)))
    }

    // Invalid input is rejected by the platform's validation *before* any
    // EventKit access, so these prove the permission gate passed without
    // prompting or touching the developer's real calendar.
    fn bad_event() -> CreateEventInput {
        CreateEventInput {
            calendar_id: None,
            title: String::new(),
            start_at: 0,
            end_at: 0,
            is_all_day: None,
            location: None,
            notes: None,
            url: None,
        }
    }

    fn bad_reminder() -> CreateReminderInput {
        CreateReminderInput {
            list_id: None,
            title: String::new(),
            due_at: None,
            priority: None,
            notes: None,
        }
    }

    #[test]
    fn all_commands_reject_without_any_permission() {
        let perms = ExtensionPermissionRegistry::new();
        assert!(is_permission_denied(&calendar_list_calendars_inner(
            &perms,
            ext()
        )));
        assert!(is_permission_denied(&calendar_list_events_inner(
            &perms,
            ext(),
            0,
            1,
            None
        )));
        assert!(is_permission_denied(&calendar_create_event_inner(
            &perms,
            ext(),
            bad_event()
        )));
        assert!(is_permission_denied(&calendar_list_reminder_lists_inner(
            &perms,
            ext()
        )));
        assert!(is_permission_denied(&calendar_list_reminders_inner(
            &perms,
            ext(),
            None,
            None
        )));
        assert!(is_permission_denied(&calendar_create_reminder_inner(
            &perms,
            ext(),
            bad_reminder()
        )));
        assert!(is_permission_denied(
            &calendar_set_reminder_completed_inner(&perms, ext(), "x".into(), true)
        ));
    }

    #[test]
    fn calendar_read_gates_only_calendar_reads() {
        let perms = registered("ext-a", &[CALENDAR_READ]);
        // Passes the gate: the bad range then fails in the platform layer.
        assert!(!is_permission_denied(&calendar_list_events_inner(
            &perms,
            ext(),
            10,
            5,
            None
        )));
        assert!(is_permission_denied(&calendar_create_event_inner(
            &perms,
            ext(),
            bad_event()
        )));
        assert!(is_permission_denied(&calendar_list_reminder_lists_inner(
            &perms,
            ext()
        )));
    }

    #[test]
    fn calendar_write_gates_only_event_creation() {
        let perms = registered("ext-a", &[CALENDAR_WRITE]);
        assert!(!is_permission_denied(&calendar_create_event_inner(
            &perms,
            ext(),
            bad_event()
        )));
        assert!(is_permission_denied(&calendar_list_calendars_inner(
            &perms,
            ext()
        )));
        assert!(is_permission_denied(&calendar_create_reminder_inner(
            &perms,
            ext(),
            bad_reminder()
        )));
    }

    #[test]
    fn reminders_read_gates_only_reminder_reads() {
        let perms = registered("ext-a", &[REMINDERS_READ]);
        assert!(is_permission_denied(&calendar_list_calendars_inner(
            &perms,
            ext()
        )));
        assert!(is_permission_denied(
            &calendar_set_reminder_completed_inner(&perms, ext(), "x".into(), true)
        ));
        assert!(is_permission_denied(&calendar_list_events_inner(
            &perms,
            ext(),
            0,
            1,
            None
        )));
    }

    #[test]
    fn reminders_write_gates_reminder_mutations() {
        let perms = registered("ext-a", &[REMINDERS_WRITE]);
        assert!(!is_permission_denied(&calendar_create_reminder_inner(
            &perms,
            ext(),
            bad_reminder()
        )));
        assert!(!is_permission_denied(
            &calendar_set_reminder_completed_inner(&perms, ext(), " ".into(), true)
        ));
        assert!(is_permission_denied(&calendar_list_reminder_lists_inner(
            &perms,
            ext()
        )));
        assert!(is_permission_denied(&calendar_list_reminders_inner(
            &perms,
            ext(),
            None,
            None
        )));
    }
}
