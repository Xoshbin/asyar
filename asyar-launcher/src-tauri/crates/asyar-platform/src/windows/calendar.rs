//! Windows calendar backend on WinRT `Windows.ApplicationModel.Appointments`.
//!
//! Reads every calendar the user has signed in to (Outlook, Google, …) through
//! the appointment store. Writes go to a calendar the app owns: WinRT only lets
//! an app save into calendars it created, so `create_event` targets (and, on
//! first use, creates) an "Asyar" calendar rather than the user's own ones.
//!
//! Windows has no local Reminders store, so every reminder call is
//! [`PlatformError::Unsupported`].

use crate::calendar::{
    AccessKind, AccessState, CalendarEvent, CalendarSource, CreateEventInput, CreateReminderInput,
    ReminderItem, ReminderList,
};
use crate::error::PlatformError;
use windows::core::HSTRING;
use windows::ApplicationModel::Appointments::{
    Appointment, AppointmentCalendar, AppointmentCalendarOtherAppWriteAccess, AppointmentManager,
    AppointmentStore, AppointmentStoreAccessType,
};
use windows::Foundation::{DateTime, TimeSpan, Uri};

/// `E_ACCESSDENIED`.
const E_ACCESSDENIED: i32 = 0x8007_0005_u32 as i32;
/// Name of the calendar Asyar creates for events it writes.
const APP_CALENDAR_NAME: &str = "Asyar";
/// `DateTime.UniversalTime` is 100 ns ticks since 1601-01-01 UTC.
const TICKS_PER_MS: i64 = 10_000;
const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

fn os_err(context: &str, e: impl std::fmt::Display) -> PlatformError {
    PlatformError::OsError(format!("Appointments {context}: {e}"))
}

fn no_reminders<T>() -> Result<T, PlatformError> {
    Err(PlatformError::Unsupported(
        "reminders are not available on Windows".into(),
    ))
}

fn ms_to_datetime(ms: i64) -> DateTime {
    DateTime {
        UniversalTime: ms * TICKS_PER_MS + UNIX_EPOCH_TICKS,
    }
}

fn datetime_to_ms(dt: DateTime) -> i64 {
    (dt.UniversalTime - UNIX_EPOCH_TICKS).div_euclid(TICKS_PER_MS)
}

fn ms_to_span(ms: i64) -> TimeSpan {
    TimeSpan {
        Duration: ms * TICKS_PER_MS,
    }
}

fn span_to_ms(span: TimeSpan) -> i64 {
    span.Duration.div_euclid(TICKS_PER_MS)
}

fn non_empty(s: HSTRING) -> Option<String> {
    let s = s.to_string();
    (!s.trim().is_empty()).then_some(s)
}

/// Runs `f` on a fresh thread. WinRT's blocking `.join()` must not run on an
/// STA thread (the UI thread), and a new thread gets an implicit MTA.
fn on_worker_thread<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, PlatformError> + Send + 'static,
) -> Result<T, PlatformError> {
    std::thread::spawn(f)
        .join()
        .map_err(|_| PlatformError::OsError("calendar worker thread panicked".into()))?
}

fn open_store(access: AppointmentStoreAccessType) -> Result<AppointmentStore, PlatformError> {
    AppointmentManager::RequestStoreAsync(access)
        .and_then(|op| op.join())
        .map_err(|e| {
            if e.code().0 == E_ACCESSDENIED {
                PlatformError::OsError(
                    "Calendar access was denied; allow it in Settings → Privacy & security → Calendar"
                        .into(),
                )
            } else {
                os_err("store", e)
            }
        })
}

fn read_only_of(calendar: &AppointmentCalendar) -> bool {
    calendar
        .OtherAppWriteAccess()
        .map(|a| a != AppointmentCalendarOtherAppWriteAccess::Limited)
        .unwrap_or(true)
}

fn calendars_of(store: &AppointmentStore) -> Result<Vec<AppointmentCalendar>, PlatformError> {
    let found = store
        .FindAppointmentCalendarsAsync()
        .and_then(|op| op.join())
        .map_err(|e| os_err("calendars", e))?;
    Ok(found.into_iter().collect())
}

pub fn access_status(kind: AccessKind) -> Result<AccessState, PlatformError> {
    match kind {
        AccessKind::Reminders => Ok(AccessState::Unsupported),
        AccessKind::Calendar => on_worker_thread(|| {
            match AppointmentManager::RequestStoreAsync(
                AppointmentStoreAccessType::AllCalendarsReadOnly,
            )
            .and_then(|op| op.join())
            {
                Ok(_) => Ok(AccessState::Granted),
                Err(e) if e.code().0 == E_ACCESSDENIED => Ok(AccessState::Denied),
                Err(e) => Err(os_err("access", e)),
            }
        }),
    }
}

/// Windows has no prompt to show here; the state is whatever the OS says.
pub fn request_access(kind: AccessKind) -> Result<AccessState, PlatformError> {
    access_status(kind)
}

pub fn list_calendars() -> Result<Vec<CalendarSource>, PlatformError> {
    on_worker_thread(|| {
        let store = open_store(AppointmentStoreAccessType::AllCalendarsReadOnly)?;
        calendars_of(&store)?
            .iter()
            .map(|c| {
                Ok(CalendarSource {
                    id: c
                        .LocalId()
                        .map_err(|e| os_err("calendar id", e))?
                        .to_string(),
                    title: c.DisplayName().map(|s| s.to_string()).unwrap_or_default(),
                    source_title: c.UserDataAccountId().ok().and_then(non_empty),
                    read_only: read_only_of(c),
                })
            })
            .collect()
    })
}

pub fn list_events(
    start_at: i64,
    end_at: i64,
    calendar_ids: Option<&[String]>,
) -> Result<Vec<CalendarEvent>, PlatformError> {
    let ids = calendar_ids.map(<[String]>::to_vec);
    on_worker_thread(move || {
        let store = open_store(AppointmentStoreAccessType::AllCalendarsReadOnly)?;
        let titles: Vec<(String, String)> = calendars_of(&store)?
            .iter()
            .filter_map(|c| {
                Some((
                    c.LocalId().ok()?.to_string(),
                    c.DisplayName().map(|s| s.to_string()).unwrap_or_default(),
                ))
            })
            .collect();
        if let Some(ids) = ids.as_ref().filter(|i| !i.is_empty()) {
            if let Some(unknown) = ids.iter().find(|id| !titles.iter().any(|(t, _)| t == *id)) {
                return Err(PlatformError::OsError(format!(
                    "unknown calendar id: {unknown}"
                )));
            }
        }
        let found = store
            .FindAppointmentsAsync(ms_to_datetime(start_at), ms_to_span(end_at - start_at))
            .and_then(|op| op.join())
            .map_err(|e| os_err("events", e))?;

        let mut out = Vec::new();
        for appt in found {
            let calendar_id = appt.CalendarId().map(|s| s.to_string()).unwrap_or_default();
            if let Some(ids) = ids.as_ref().filter(|i| !i.is_empty()) {
                if !ids.contains(&calendar_id) {
                    continue;
                }
            }
            out.push(to_event(&appt, &calendar_id, &titles));
        }
        out.sort_by_key(|e| e.start_at);
        Ok(out)
    })
}

fn to_event(appt: &Appointment, calendar_id: &str, titles: &[(String, String)]) -> CalendarEvent {
    let start_at = appt.StartTime().map(datetime_to_ms).unwrap_or(0);
    let duration = appt.Duration().map(span_to_ms).unwrap_or(0);
    CalendarEvent {
        id: appt.LocalId().map(|s| s.to_string()).unwrap_or_default(),
        calendar_id: calendar_id.to_string(),
        calendar_title: titles
            .iter()
            .find(|(id, _)| id == calendar_id)
            .map(|(_, t)| t.clone())
            .unwrap_or_default(),
        title: appt.Subject().map(|s| s.to_string()).unwrap_or_default(),
        start_at,
        end_at: start_at + duration.max(0),
        is_all_day: appt.AllDay().unwrap_or(false),
        location: appt.Location().ok().and_then(non_empty),
        notes: appt.Details().ok().and_then(non_empty),
        url: appt
            .Uri()
            .ok()
            .and_then(|u| u.AbsoluteUri().ok())
            .and_then(non_empty),
    }
}

/// The calendar new events are written to: the named one, else Asyar's own
/// (created on first use).
fn write_calendar(
    store: &AppointmentStore,
    calendar_id: Option<&str>,
) -> Result<AppointmentCalendar, PlatformError> {
    let own = calendars_of(store)?;
    match calendar_id {
        Some(id) => own
            .into_iter()
            .find(|c| c.LocalId().is_ok_and(|l| l == id))
            .ok_or_else(|| {
                PlatformError::OsError(format!(
                    "calendar {id} is not writable by Asyar (apps can only write calendars they created)"
                ))
            }),
        None => match own.into_iter().next() {
            Some(c) => Ok(c),
            None => store
                .CreateAppointmentCalendarAsync(&HSTRING::from(APP_CALENDAR_NAME))
                .and_then(|op| op.join())
                .map_err(|e| os_err("create calendar", e)),
        },
    }
}

pub fn create_event(input: CreateEventInput) -> Result<CalendarEvent, PlatformError> {
    on_worker_thread(move || {
        let store = open_store(AppointmentStoreAccessType::AppCalendarsReadWrite)?;
        let calendar = write_calendar(&store, input.calendar_id.as_deref())?;
        if read_only_of(&calendar) && input.calendar_id.is_some() {
            return Err(PlatformError::OsError("that calendar is read-only".into()));
        }
        let calendar_id = calendar
            .LocalId()
            .map(|s| s.to_string())
            .map_err(|e| os_err("calendar id", e))?;
        let title = calendar
            .DisplayName()
            .map(|s| s.to_string())
            .unwrap_or_default();

        let appt = Appointment::new().map_err(|e| os_err("new appointment", e))?;
        let set = |r: windows::core::Result<()>| r.map_err(|e| os_err("set field", e));
        set(appt.SetSubject(&HSTRING::from(input.title.as_str())))?;
        set(appt.SetStartTime(ms_to_datetime(input.start_at)))?;
        set(appt.SetDuration(ms_to_span(input.end_at - input.start_at)))?;
        set(appt.SetAllDay(input.is_all_day.unwrap_or(false)))?;
        if let Some(v) = input.location.as_deref() {
            set(appt.SetLocation(&HSTRING::from(v)))?;
        }
        if let Some(v) = input.notes.as_deref() {
            set(appt.SetDetails(&HSTRING::from(v)))?;
        }
        if let Some(v) = input.url.as_deref().filter(|u| !u.is_empty()) {
            let uri = Uri::CreateUri(&HSTRING::from(v))
                .map_err(|e| PlatformError::OsError(format!("invalid url: {e}")))?;
            set(appt.SetUri(&uri))?;
        }

        calendar
            .SaveAppointmentAsync(&appt)
            .and_then(|op| op.join())
            .map_err(|e| os_err("save", e))?;
        Ok(to_event(
            &appt,
            &calendar_id,
            &[(calendar_id.clone(), title)],
        ))
    })
}

pub fn list_reminder_lists() -> Result<Vec<ReminderList>, PlatformError> {
    no_reminders()
}

pub fn list_reminders(
    _list_ids: Option<&[String]>,
    _include_completed: bool,
) -> Result<Vec<ReminderItem>, PlatformError> {
    no_reminders()
}

pub fn create_reminder(_input: CreateReminderInput) -> Result<ReminderItem, PlatformError> {
    no_reminders()
}

pub fn set_reminder_completed(_id: &str, _completed: bool) -> Result<ReminderItem, PlatformError> {
    no_reminders()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn datetime_round_trips_through_unix_ms() {
        for ms in [0_i64, 1, 1_700_000_000_123, -86_400_000] {
            assert_eq!(datetime_to_ms(ms_to_datetime(ms)), ms);
        }
        assert_eq!(ms_to_datetime(0).UniversalTime, UNIX_EPOCH_TICKS);
    }

    #[test]
    fn timespan_round_trips() {
        assert_eq!(span_to_ms(ms_to_span(3_600_000)), 3_600_000);
    }

    #[test]
    fn reminders_are_unsupported() {
        assert!(matches!(
            list_reminder_lists(),
            Err(PlatformError::Unsupported(_))
        ));
        assert!(matches!(
            set_reminder_completed("x", true),
            Err(PlatformError::Unsupported(_))
        ));
        assert_eq!(
            access_status(AccessKind::Reminders).unwrap(),
            AccessState::Unsupported
        );
    }
}
