//! macOS calendar and reminders backend on top of `EventKit`.
//!
//! `objc2-event-kit` is not a dependency, so `EventKit` is driven through raw
//! `msg_send!` calls on [`AnyObject`]. The rules that keep that safe:
//!
//! - Object returns/arguments are `*mut AnyObject` / `Retained<…>` (encoding
//!   `@`), `BOOL` is [`Bool`], `NSInteger`/`NSUInteger` are `isize`/`usize` and
//!   `NSError **` is `*mut *mut AnyObject` (`^@`). Never `*mut c_void`: objc2
//!   verifies encodings in debug builds and a mismatch panics.
//! - Every public entry point runs on a short-lived worker thread inside an
//!   autorelease pool and behind [`guard`], which turns Objective-C exceptions
//!   and Rust panics into [`PlatformError::OsError`] instead of unwinding
//!   through the caller (often the Tauri/UI thread).
//! - `EventKit`'s completion-handler APIs are bridged to blocking calls with a
//!   `block2::RcBlock` and an `mpsc` channel; the worker thread blocks, never
//!   the caller's run loop, so a completion that hops threads cannot deadlock.

use crate::calendar::{
    AccessKind, AccessState, CalendarEvent, CalendarSource, CreateEventInput, CreateReminderInput,
    ReminderItem, ReminderList,
};
use crate::error::PlatformError;
use block2::RcBlock;
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, msg_send_id, sel, ClassType};
use objc2_foundation::{NSArray, NSDate, NSString, NSURL};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc;
use std::time::Duration;

#[link(name = "EventKit", kind = "framework")]
extern "C" {}

/// Upper bound for one operation, including the one-time permission prompt
/// (the user may take a while to answer it).
const OP_TIMEOUT: Duration = Duration::from_secs(300);
/// Upper bound for `EventKit` to answer a reminders fetch once permitted.
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);

// EKEntityType
const ENTITY_EVENT: usize = 0;
const ENTITY_REMINDER: usize = 1;
// EKAuthorizationStatus
const AUTH_NOT_DETERMINED: isize = 0;
const AUTH_FULL_ACCESS: isize = 3;
const AUTH_WRITE_ONLY: isize = 4;
// EKSpan
const SPAN_THIS_EVENT: isize = 0;
// NSCalendarUnit: year | month | day | hour | minute | second
const DATE_COMPONENT_UNITS: usize = 4 | 8 | 16 | 32 | 64 | 128;

type Obj = AnyObject;

// ── pure helpers ──────────────────────────────────────────────────────────

fn ms_to_secs(ms: i64) -> f64 {
    ms as f64 / 1000.0
}

fn secs_to_ms(secs: f64) -> i64 {
    (secs * 1000.0).round() as i64
}

fn os_err(msg: impl Into<String>) -> PlatformError {
    PlatformError::OsError(msg.into())
}

// ── execution scaffolding ─────────────────────────────────────────────────

/// Converts Objective-C exceptions and Rust panics into errors.
///
/// The panic catch sits *inside* the exception catch: a Rust panic unwinding
/// through objc2's foreign `@try` frame aborts the process.
fn guard<T>(f: impl FnOnce() -> Result<T, PlatformError>) -> Result<T, PlatformError> {
    // SAFETY: `f` only makes EventKit calls; no state is shared across the catch.
    let caught =
        unsafe { objc2::exception::catch(AssertUnwindSafe(|| catch_unwind(AssertUnwindSafe(f)))) };
    match caught {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(os_err("EventKit call panicked")),
        Err(exception) => Err(os_err(format!(
            "EventKit raised an Objective-C exception: {exception:?}"
        ))),
    }
}

/// Runs `f` on a dedicated thread (own autorelease pool, guarded) and waits for
/// the result. Keeps blocking `EventKit` work off the caller's thread.
fn on_worker<T, F>(f: F) -> Result<T, PlatformError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, PlatformError> + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("asyar-eventkit".into())
        .spawn(move || {
            let result = autoreleasepool(|_| guard(f));
            let _ = tx.send(result);
        })
        .map_err(|e| os_err(format!("could not start EventKit worker: {e}")))?;
    rx.recv_timeout(OP_TIMEOUT)
        .map_err(|_| os_err("EventKit did not respond in time"))?
}

fn class(name: &str) -> Result<&'static AnyClass, PlatformError> {
    AnyClass::get(name).ok_or_else(|| os_err(format!("{name} is unavailable on this system")))
}

// ── Foundation conversions ────────────────────────────────────────────────

/// Reads an `NSString *` (possibly nil) into an owned `String`.
unsafe fn ns_string(ptr: *mut Obj) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let s: &NSString = &*(ptr as *const NSString);
    Some(s.to_string())
}

/// `Some` only for a non-empty string — EventKit returns "" for unset fields.
unsafe fn ns_string_nonempty(ptr: *mut Obj) -> Option<String> {
    ns_string(ptr).filter(|s| !s.is_empty())
}

unsafe fn date_to_ms(date: *mut Obj) -> Option<i64> {
    if date.is_null() {
        return None;
    }
    let secs: f64 = msg_send![date, timeIntervalSince1970];
    Some(secs_to_ms(secs))
}

fn ms_to_date(ms: i64) -> Result<Retained<NSDate>, PlatformError> {
    let date: Option<Retained<NSDate>> =
        unsafe { msg_send_id![NSDate::class(), dateWithTimeIntervalSince1970: ms_to_secs(ms)] };
    date.ok_or_else(|| os_err("could not build a date"))
}

unsafe fn error_text(error: *mut Obj, fallback: &str) -> String {
    if error.is_null() {
        return fallback.to_string();
    }
    let desc: *mut Obj = msg_send![error, localizedDescription];
    ns_string(desc).unwrap_or_else(|| fallback.to_string())
}

fn current_calendar() -> Result<Retained<Obj>, PlatformError> {
    let cls = class("NSCalendar")?;
    let calendar: Option<Retained<Obj>> = unsafe { msg_send_id![cls, currentCalendar] };
    calendar.ok_or_else(|| os_err("no current calendar"))
}

/// A due date as the date components `EKReminder` stores (local time zone).
fn ms_to_components(ms: i64) -> Result<Retained<Obj>, PlatformError> {
    let date = ms_to_date(ms)?;
    let calendar = current_calendar()?;
    let components: Option<Retained<Obj>> = unsafe {
        msg_send_id![
            &*calendar,
            components: DATE_COMPONENT_UNITS,
            fromDate: &*date
        ]
    };
    components.ok_or_else(|| os_err("could not build date components"))
}

unsafe fn components_to_ms(components: *mut Obj) -> Option<i64> {
    if components.is_null() {
        return None;
    }
    let own: *mut Obj = msg_send![components, calendar];
    let date: *mut Obj = if own.is_null() {
        let current = current_calendar().ok()?;
        msg_send![&*current, dateFromComponents: components]
    } else {
        msg_send![own, dateFromComponents: components]
    };
    date_to_ms(date)
}

fn ns_array_of(items: Vec<Retained<Obj>>) -> Retained<NSArray<Obj>> {
    NSArray::from_vec(items)
}

// ── store, authorization ──────────────────────────────────────────────────

fn new_store() -> Result<Retained<Obj>, PlatformError> {
    let cls = class("EKEventStore")?;
    let store: Option<Retained<Obj>> = unsafe { msg_send_id![cls, new] };
    store.ok_or_else(|| os_err("could not create EKEventStore"))
}

fn access_label(entity: usize) -> &'static str {
    if entity == ENTITY_EVENT {
        "Calendar"
    } else {
        "Reminders"
    }
}

/// Makes sure the user granted full access to `entity`, prompting once if the
/// decision is still open.
fn ensure_access(store: &Obj, entity: usize) -> Result<(), PlatformError> {
    let cls = class("EKEventStore")?;
    let status: isize = unsafe { msg_send![cls, authorizationStatusForEntityType: entity] };
    match status {
        AUTH_FULL_ACCESS => return Ok(()),
        AUTH_NOT_DETERMINED => {}
        AUTH_WRITE_ONLY => {
            return Err(os_err(format!(
            "{} access is write-only; grant full access in System Settings → Privacy & Security",
            access_label(entity)
        )))
        }
        _ => {
            return Err(os_err(format!(
                "{} access was denied; allow Asyar in System Settings → Privacy & Security → {}",
                access_label(entity),
                access_label(entity)
            )))
        }
    }

    let (tx, rx) = mpsc::channel::<bool>();
    let block = RcBlock::new(move |granted: Bool, _error: *mut Obj| {
        let _ = tx.send(granted.as_bool());
    });
    let selector = if entity == ENTITY_EVENT {
        sel!(requestFullAccessToEventsWithCompletion:)
    } else {
        sel!(requestFullAccessToRemindersWithCompletion:)
    };
    let responds: Bool = unsafe { msg_send![store, respondsToSelector: selector] };
    unsafe {
        if responds.as_bool() {
            if entity == ENTITY_EVENT {
                let _: () = msg_send![store, requestFullAccessToEventsWithCompletion: &*block];
            } else {
                let _: () = msg_send![store, requestFullAccessToRemindersWithCompletion: &*block];
            }
        } else {
            // macOS 13 and earlier.
            let _: () = msg_send![store, requestAccessToEntityType: entity, completion: &*block];
        }
    }
    match rx.recv_timeout(OP_TIMEOUT) {
        Ok(true) => Ok(()),
        Ok(false) => Err(os_err(format!(
            "{} access was not granted",
            access_label(entity)
        ))),
        Err(_) => Err(os_err("timed out waiting for the access prompt")),
    }
}

fn entity_of(kind: AccessKind) -> usize {
    match kind {
        AccessKind::Calendar => ENTITY_EVENT,
        AccessKind::Reminders => ENTITY_REMINDER,
    }
}

fn state_of(status: isize) -> AccessState {
    match status {
        AUTH_NOT_DETERMINED => AccessState::NotDetermined,
        AUTH_FULL_ACCESS => AccessState::Granted,
        AUTH_WRITE_ONLY => AccessState::WriteOnly,
        _ => AccessState::Denied,
    }
}

fn current_state(entity: usize) -> Result<AccessState, PlatformError> {
    let cls = class("EKEventStore")?;
    let status: isize = unsafe { msg_send![cls, authorizationStatusForEntityType: entity] };
    Ok(state_of(status))
}

pub fn access_status(kind: AccessKind) -> Result<AccessState, PlatformError> {
    on_worker(move || current_state(entity_of(kind)))
}

pub fn request_access(kind: AccessKind) -> Result<AccessState, PlatformError> {
    on_worker(move || {
        let entity = entity_of(kind);
        if current_state(entity)? == AccessState::NotDetermined {
            let store = new_store()?;
            // A refusal is reported through the resulting state, not an error.
            let _ = ensure_access(&store, entity);
        }
        current_state(entity)
    })
}

// ── calendars ─────────────────────────────────────────────────────────────

unsafe fn source_fields(calendar: &Obj) -> (String, String, Option<String>, bool) {
    let id = ns_string(msg_send![calendar, calendarIdentifier]).unwrap_or_default();
    let title = ns_string(msg_send![calendar, title]).unwrap_or_default();
    let source: *mut Obj = msg_send![calendar, source];
    let source_title = if source.is_null() {
        None
    } else {
        ns_string_nonempty(msg_send![source, title])
    };
    let modifiable: Bool = msg_send![calendar, allowsContentModifications];
    (id, title, source_title, !modifiable.as_bool())
}

fn calendars_for(store: &Obj, entity: usize) -> Result<Retained<NSArray<Obj>>, PlatformError> {
    let list: Option<Retained<NSArray<Obj>>> =
        unsafe { msg_send_id![store, calendarsForEntityType: entity] };
    list.ok_or_else(|| os_err("EventKit returned no calendar list"))
}

/// Resolves ids to calendar objects; an unknown id is an error rather than a
/// silently narrower search.
fn calendars_by_id(
    store: &Obj,
    entity: usize,
    ids: Option<&[String]>,
) -> Result<Option<Retained<NSArray<Obj>>>, PlatformError> {
    let Some(ids) = ids else { return Ok(None) };
    if ids.is_empty() {
        return Ok(None);
    }
    let all = calendars_for(store, entity)?;
    let mut picked = Vec::with_capacity(ids.len());
    for wanted in ids {
        let found = all.iter().find(|c| {
            let id = unsafe { ns_string(msg_send![*c, calendarIdentifier]) };
            id.as_deref() == Some(wanted.as_str())
        });
        match found {
            Some(c) => match unsafe { Retained::retain(c as *const Obj as *mut Obj) } {
                Some(c) => picked.push(c),
                None => return Err(os_err("could not retain a calendar")),
            },
            None => return Err(os_err(format!("unknown calendar id: {wanted}"))),
        }
    }
    Ok(Some(ns_array_of(picked)))
}

pub fn list_calendars() -> Result<Vec<CalendarSource>, PlatformError> {
    on_worker(|| {
        let store = new_store()?;
        ensure_access(&store, ENTITY_EVENT)?;
        let calendars = calendars_for(&store, ENTITY_EVENT)?;
        Ok(calendars
            .iter()
            .map(|c| {
                let (id, title, source_title, read_only) = unsafe { source_fields(c) };
                CalendarSource {
                    id,
                    title,
                    source_title,
                    read_only,
                }
            })
            .collect())
    })
}

// ── events ────────────────────────────────────────────────────────────────

unsafe fn event_to_dto(event: &Obj) -> CalendarEvent {
    let calendar: *mut Obj = msg_send![event, calendar];
    let (calendar_id, calendar_title) = if calendar.is_null() {
        (String::new(), String::new())
    } else {
        (
            ns_string(msg_send![calendar, calendarIdentifier]).unwrap_or_default(),
            ns_string(msg_send![calendar, title]).unwrap_or_default(),
        )
    };
    let id = ns_string_nonempty(msg_send![event, eventIdentifier])
        .or_else(|| ns_string(msg_send![event, calendarItemIdentifier]))
        .unwrap_or_default();
    let all_day: Bool = msg_send![event, isAllDay];
    let url: *mut Obj = msg_send![event, URL];
    let url = if url.is_null() {
        None
    } else {
        ns_string_nonempty(msg_send![url, absoluteString])
    };
    CalendarEvent {
        id,
        calendar_id,
        calendar_title,
        title: ns_string(msg_send![event, title]).unwrap_or_default(),
        start_at: date_to_ms(msg_send![event, startDate]).unwrap_or(0),
        end_at: date_to_ms(msg_send![event, endDate]).unwrap_or(0),
        is_all_day: all_day.as_bool(),
        location: ns_string_nonempty(msg_send![event, location]),
        notes: ns_string_nonempty(msg_send![event, notes]),
        url,
    }
}

pub fn list_events(
    start_at: i64,
    end_at: i64,
    calendar_ids: Option<&[String]>,
) -> Result<Vec<CalendarEvent>, PlatformError> {
    let ids = calendar_ids.map(<[String]>::to_vec);
    on_worker(move || {
        let store = new_store()?;
        ensure_access(&store, ENTITY_EVENT)?;
        let calendars = calendars_by_id(&store, ENTITY_EVENT, ids.as_deref())?;
        let start = ms_to_date(start_at)?;
        let end = ms_to_date(end_at)?;
        let predicate: Option<Retained<Obj>> = unsafe {
            msg_send_id![
                &*store,
                predicateForEventsWithStartDate: &*start,
                endDate: &*end,
                calendars: calendars.as_deref()
            ]
        };
        let predicate = predicate.ok_or_else(|| os_err("could not build the event query"))?;
        let events: Option<Retained<NSArray<Obj>>> =
            unsafe { msg_send_id![&*store, eventsMatchingPredicate: &*predicate] };
        let mut out: Vec<CalendarEvent> = events
            .map(|events| events.iter().map(|e| unsafe { event_to_dto(e) }).collect())
            .unwrap_or_default();
        out.sort_by_key(|e| e.start_at);
        Ok(out)
    })
}

pub fn create_event(input: CreateEventInput) -> Result<CalendarEvent, PlatformError> {
    on_worker(move || {
        let store = new_store()?;
        ensure_access(&store, ENTITY_EVENT)?;

        let calendar: Option<Retained<Obj>> = match &input.calendar_id {
            Some(id) => unsafe {
                msg_send_id![&*store, calendarWithIdentifier: &*NSString::from_str(id)]
            },
            None => unsafe { msg_send_id![&*store, defaultCalendarForNewEvents] },
        };
        let calendar = calendar.ok_or_else(|| match &input.calendar_id {
            Some(id) => os_err(format!("unknown calendar id: {id}")),
            None => os_err("no default calendar for new events is configured"),
        })?;
        let modifiable: Bool = unsafe { msg_send![&*calendar, allowsContentModifications] };
        if !modifiable.as_bool() {
            return Err(os_err("that calendar is read-only"));
        }

        let url = match input.url.as_deref().filter(|u| !u.is_empty()) {
            Some(raw) => {
                let url: Option<Retained<NSURL>> = unsafe {
                    msg_send_id![NSURL::class(), URLWithString: &*NSString::from_str(raw)]
                };
                Some(url.ok_or_else(|| os_err(format!("invalid url: {raw}")))?)
            }
            None => None,
        };

        let cls = class("EKEvent")?;
        let event: Option<Retained<Obj>> =
            unsafe { msg_send_id![cls, eventWithEventStore: &*store] };
        let event = event.ok_or_else(|| os_err("could not create the event"))?;
        let start = ms_to_date(input.start_at)?;
        let end = ms_to_date(input.end_at)?;
        unsafe {
            let _: () = msg_send![&*event, setCalendar: &*calendar];
            let _: () = msg_send![&*event, setTitle: &*NSString::from_str(&input.title)];
            let _: () = msg_send![&*event, setStartDate: &*start];
            let _: () = msg_send![&*event, setEndDate: &*end];
            let _: () = msg_send![
                &*event,
                setAllDay: Bool::new(input.is_all_day.unwrap_or(false))
            ];
            if let Some(location) = &input.location {
                let _: () = msg_send![&*event, setLocation: &*NSString::from_str(location)];
            }
            if let Some(notes) = &input.notes {
                let _: () = msg_send![&*event, setNotes: &*NSString::from_str(notes)];
            }
            if let Some(url) = &url {
                let _: () = msg_send![&*event, setURL: &**url];
            }

            let mut error: *mut Obj = std::ptr::null_mut();
            let saved: Bool = msg_send![
                &*store,
                saveEvent: &*event,
                span: SPAN_THIS_EVENT,
                commit: Bool::YES,
                error: &mut error
            ];
            if !saved.as_bool() {
                return Err(os_err(error_text(error, "could not save the event")));
            }
            Ok(event_to_dto(&event))
        }
    })
}

// ── reminders ─────────────────────────────────────────────────────────────

unsafe fn reminder_to_dto(reminder: &Obj) -> ReminderItem {
    let list: *mut Obj = msg_send![reminder, calendar];
    let (list_id, list_title) = if list.is_null() {
        (String::new(), String::new())
    } else {
        (
            ns_string(msg_send![list, calendarIdentifier]).unwrap_or_default(),
            ns_string(msg_send![list, title]).unwrap_or_default(),
        )
    };
    let completed: Bool = msg_send![reminder, isCompleted];
    let priority: usize = msg_send![reminder, priority];
    ReminderItem {
        id: ns_string(msg_send![reminder, calendarItemIdentifier]).unwrap_or_default(),
        list_id,
        list_title,
        title: ns_string(msg_send![reminder, title]).unwrap_or_default(),
        is_completed: completed.as_bool(),
        due_at: components_to_ms(msg_send![reminder, dueDateComponents]),
        priority: i32::try_from(priority).unwrap_or(0),
        notes: ns_string_nonempty(msg_send![reminder, notes]),
    }
}

pub fn list_reminder_lists() -> Result<Vec<ReminderList>, PlatformError> {
    on_worker(|| {
        let store = new_store()?;
        ensure_access(&store, ENTITY_REMINDER)?;
        let lists = calendars_for(&store, ENTITY_REMINDER)?;
        Ok(lists
            .iter()
            .map(|c| {
                let (id, title, source_title, read_only) = unsafe { source_fields(c) };
                ReminderList {
                    id,
                    title,
                    source_title,
                    read_only,
                }
            })
            .collect())
    })
}

pub fn list_reminders(
    list_ids: Option<&[String]>,
    include_completed: bool,
) -> Result<Vec<ReminderItem>, PlatformError> {
    let ids = list_ids.map(<[String]>::to_vec);
    on_worker(move || {
        let store = new_store()?;
        ensure_access(&store, ENTITY_REMINDER)?;
        let lists = calendars_by_id(&store, ENTITY_REMINDER, ids.as_deref())?;
        let predicate: Option<Retained<Obj>> = unsafe {
            if include_completed {
                msg_send_id![&*store, predicateForRemindersInCalendars: lists.as_deref()]
            } else {
                msg_send_id![
                    &*store,
                    predicateForIncompleteRemindersWithDueDateStarting: Option::<&NSDate>::None,
                    ending: Option::<&NSDate>::None,
                    calendars: lists.as_deref()
                ]
            }
        };
        let predicate = predicate.ok_or_else(|| os_err("could not build the reminder query"))?;

        let (tx, rx) = mpsc::channel::<Result<Vec<ReminderItem>, String>>();
        // Runs on an EventKit-owned queue: convert inside the block (the
        // reminders are only guaranteed alive there) and never let a panic
        // cross the block's `extern "C"` boundary.
        let block = RcBlock::new(move |reminders: *mut Obj| {
            let converted = catch_unwind(AssertUnwindSafe(|| {
                autoreleasepool(|_| {
                    if reminders.is_null() {
                        return Vec::new();
                    }
                    let array: &NSArray<Obj> = unsafe { &*(reminders as *const NSArray<Obj>) };
                    array
                        .iter()
                        .map(|r| unsafe { reminder_to_dto(r) })
                        .collect()
                })
            }))
            .map_err(|_| "could not read reminders".to_string());
            let _ = tx.send(converted);
        });
        let _token: *mut Obj = unsafe {
            msg_send![
                &*store,
                fetchRemindersMatchingPredicate: &*predicate,
                completion: &*block
            ]
        };
        let mut out = rx
            .recv_timeout(FETCH_TIMEOUT)
            .map_err(|_| os_err("timed out reading reminders"))?
            .map_err(os_err)?;
        out.sort_by(|a, b| {
            (a.is_completed, a.due_at.is_none(), a.due_at, &a.title).cmp(&(
                b.is_completed,
                b.due_at.is_none(),
                b.due_at,
                &b.title,
            ))
        });
        Ok(out)
    })
}

pub fn create_reminder(input: CreateReminderInput) -> Result<ReminderItem, PlatformError> {
    on_worker(move || {
        let store = new_store()?;
        ensure_access(&store, ENTITY_REMINDER)?;

        let list: Option<Retained<Obj>> = match &input.list_id {
            Some(id) => unsafe {
                msg_send_id![&*store, calendarWithIdentifier: &*NSString::from_str(id)]
            },
            None => unsafe { msg_send_id![&*store, defaultCalendarForNewReminders] },
        };
        let list = list.ok_or_else(|| match &input.list_id {
            Some(id) => os_err(format!("unknown reminder list id: {id}")),
            None => os_err("no default reminder list is configured"),
        })?;
        let modifiable: Bool = unsafe { msg_send![&*list, allowsContentModifications] };
        if !modifiable.as_bool() {
            return Err(os_err("that reminder list is read-only"));
        }

        let cls = class("EKReminder")?;
        let reminder: Option<Retained<Obj>> =
            unsafe { msg_send_id![cls, reminderWithEventStore: &*store] };
        let reminder = reminder.ok_or_else(|| os_err("could not create the reminder"))?;
        unsafe {
            let _: () = msg_send![&*reminder, setCalendar: &*list];
            let _: () = msg_send![&*reminder, setTitle: &*NSString::from_str(&input.title)];
            if let Some(due_at) = input.due_at {
                let components = ms_to_components(due_at)?;
                let _: () = msg_send![&*reminder, setDueDateComponents: &*components];
            }
            if let Some(priority) = input.priority {
                let _: () = msg_send![&*reminder, setPriority: priority.clamp(0, 9) as usize];
            }
            if let Some(notes) = &input.notes {
                let _: () = msg_send![&*reminder, setNotes: &*NSString::from_str(notes)];
            }

            let mut error: *mut Obj = std::ptr::null_mut();
            let saved: Bool = msg_send![
                &*store,
                saveReminder: &*reminder,
                commit: Bool::YES,
                error: &mut error
            ];
            if !saved.as_bool() {
                return Err(os_err(error_text(error, "could not save the reminder")));
            }
            Ok(reminder_to_dto(&reminder))
        }
    })
}

pub fn set_reminder_completed(id: &str, completed: bool) -> Result<ReminderItem, PlatformError> {
    let id = id.to_string();
    on_worker(move || {
        let store = new_store()?;
        ensure_access(&store, ENTITY_REMINDER)?;

        let item: Option<Retained<Obj>> =
            unsafe { msg_send_id![&*store, calendarItemWithIdentifier: &*NSString::from_str(&id)] };
        let reminder = item.ok_or_else(|| os_err(format!("unknown reminder id: {id}")))?;
        let is_reminder: Bool =
            unsafe { msg_send![&*reminder, isKindOfClass: class("EKReminder")?] };
        if !is_reminder.as_bool() {
            return Err(os_err(format!("{id} is not a reminder")));
        }
        unsafe {
            let _: () = msg_send![&*reminder, setCompleted: Bool::new(completed)];
            let mut error: *mut Obj = std::ptr::null_mut();
            let saved: Bool = msg_send![
                &*store,
                saveReminder: &*reminder,
                commit: Bool::YES,
                error: &mut error
            ];
            if !saved.as_bool() {
                return Err(os_err(error_text(error, "could not update the reminder")));
            }
            Ok(reminder_to_dto(&reminder))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn millisecond_second_conversion_round_trips() {
        assert_eq!(ms_to_secs(1_500), 1.5);
        assert_eq!(secs_to_ms(1.5), 1_500);
        for ms in [0_i64, 1, 999, 1_700_000_000_123] {
            assert_eq!(secs_to_ms(ms_to_secs(ms)), ms);
        }
    }

    #[test]
    fn date_round_trips_through_nsdate() {
        autoreleasepool(|_| {
            let date = ms_to_date(1_700_000_000_123).unwrap();
            let ptr = Retained::as_ptr(&date) as *mut Obj;
            assert_eq!(unsafe { date_to_ms(ptr) }, Some(1_700_000_000_123));
            assert_eq!(unsafe { date_to_ms(std::ptr::null_mut()) }, None);
        });
    }

    #[test]
    fn due_date_components_round_trip_to_the_second() {
        autoreleasepool(|_| {
            // Components carry whole seconds, so sub-second precision drops.
            let components = ms_to_components(1_700_000_000_999).unwrap();
            let ptr = Retained::as_ptr(&components) as *mut Obj;
            assert_eq!(unsafe { components_to_ms(ptr) }, Some(1_700_000_000_000));
            assert_eq!(unsafe { components_to_ms(std::ptr::null_mut()) }, None);
        });
    }

    #[test]
    fn authorization_status_maps_to_access_state() {
        assert_eq!(state_of(0), AccessState::NotDetermined);
        assert_eq!(state_of(1), AccessState::Denied);
        assert_eq!(state_of(2), AccessState::Denied);
        assert_eq!(state_of(3), AccessState::Granted);
        assert_eq!(state_of(4), AccessState::WriteOnly);
    }

    #[test]
    fn guard_converts_panics_to_errors() {
        let result: Result<(), _> = guard(|| panic!("boom"));
        assert!(matches!(result, Err(PlatformError::OsError(_))));
    }

    #[test]
    fn guard_passes_results_through() {
        assert_eq!(guard(|| Ok(7)).unwrap(), 7);
    }
}
