//! Linux calendar and reminders backend: local iCalendar (`.ics`) files.
//!
//! Linux has no single calendar API, so this reads and writes plain `.ics`
//! files (`VEVENT` events, `VTODO` reminders) through [`crate::ics`]:
//!
//! 1. `$XDG_DATA_HOME/asyar/calendars/` (default `~/.local/share/asyar/calendars/`);
//!    `default.ics` is created here on the first write.
//! 2. `$XDG_DATA_HOME/evolution/calendar/system/calendar.ics` — listed
//!    read-only (Evolution Data Server owns it).
//! 3. `$XDG_DATA_HOME/calendars/*.ics`.
//!
//! There is no OS permission to ask for: access is always granted.

use crate::calendar::{
    AccessKind, AccessState, CalendarEvent, CalendarSource, CreateEventInput, CreateReminderInput,
    ReminderItem, ReminderList,
};
use crate::error::PlatformError;
use crate::ics::{Roots, Store};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn data_home() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| dirs::home_dir().map(|h| h.join(".local/share")))
}

fn store() -> Result<Store, PlatformError> {
    let base = data_home()
        .ok_or_else(|| PlatformError::OsError("could not locate the user data directory".into()))?;
    Ok(Store::new(Roots {
        asyar_dir: base.join("asyar/calendars"),
        evolution_file: Some(base.join("evolution/calendar/system/calendar.ics")),
        shared_dir: Some(base.join("calendars")),
    }))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn access_status(_kind: AccessKind) -> Result<AccessState, PlatformError> {
    Ok(AccessState::Granted)
}

pub fn request_access(_kind: AccessKind) -> Result<AccessState, PlatformError> {
    Ok(AccessState::Granted)
}

pub fn list_calendars() -> Result<Vec<CalendarSource>, PlatformError> {
    Ok(store()?.list_calendars())
}

pub fn list_events(
    start_at: i64,
    end_at: i64,
    calendar_ids: Option<&[String]>,
) -> Result<Vec<CalendarEvent>, PlatformError> {
    store()?.list_events(start_at, end_at, calendar_ids)
}

pub fn create_event(input: CreateEventInput) -> Result<CalendarEvent, PlatformError> {
    store()?.create_event(&input, now_ms())
}

pub fn list_reminder_lists() -> Result<Vec<ReminderList>, PlatformError> {
    Ok(store()?.list_reminder_lists())
}

pub fn list_reminders(
    list_ids: Option<&[String]>,
    include_completed: bool,
) -> Result<Vec<ReminderItem>, PlatformError> {
    store()?.list_reminders(list_ids, include_completed)
}

pub fn create_reminder(input: CreateReminderInput) -> Result<ReminderItem, PlatformError> {
    store()?.create_reminder(&input, now_ms())
}

pub fn set_reminder_completed(id: &str, completed: bool) -> Result<ReminderItem, PlatformError> {
    store()?.set_reminder_completed(id, completed, now_ms())
}
