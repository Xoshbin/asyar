/** A calendar the user has, e.g. "Work" in iCloud. */
export interface CalendarSource {
  id: string;
  title: string;
  /** The account the calendar belongs to, e.g. `iCloud`. */
  sourceTitle: string | null;
  /** `true` for subscribed or shared calendars that cannot be edited. */
  readOnly: boolean;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarTitle: string;
  title: string;
  /** Unix timestamp in milliseconds. */
  startAt: number;
  /** Unix timestamp in milliseconds. */
  endAt: number;
  isAllDay: boolean;
  location: string | null;
  notes: string | null;
  url: string | null;
}

export interface CreateEventInput {
  /** Defaults to the user's default calendar for new events. */
  calendarId?: string;
  title: string;
  /** Unix timestamp in milliseconds. */
  startAt: number;
  /** Unix timestamp in milliseconds; must not be before `startAt`. */
  endAt: number;
  isAllDay?: boolean;
  location?: string;
  notes?: string;
  url?: string;
}

/** A Reminders list, e.g. "Groceries". */
export interface ReminderList {
  id: string;
  title: string;
  sourceTitle: string | null;
  readOnly: boolean;
}

export interface ReminderItem {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  isCompleted: boolean;
  /** Unix timestamp in milliseconds, or `null` when no due date is set. */
  dueAt: number | null;
  /** `0` none, `1`–`4` high, `5` medium, `6`–`9` low. */
  priority: number;
  notes: string | null;
}

export interface CreateReminderInput {
  /** Defaults to the user's default reminder list. */
  listId?: string;
  title: string;
  /** Unix timestamp in milliseconds. */
  dueAt?: number;
  /** `0` none, `1`–`4` high, `5` medium, `6`–`9` low. */
  priority?: number;
  notes?: string;
}

/**
 * Read and create calendar events and reminders.
 *
 * Available on macOS (EventKit), Linux (local `.ics` files) and Windows (calendar
 * only; reminder calls reject). On macOS the first call prompts the user for
 * Calendar or Reminders access. Four manifest
 * permissions gate it: `calendar:read` (`listCalendars`, `listEvents`),
 * `calendar:write` (`createEvent`), `reminders:read` (`listReminderLists`,
 * `listReminders`) and `reminders:write` (`createReminder`,
 * `setReminderCompleted`).
 */
export interface ICalendarService {
  /** Every calendar, including read-only ones. */
  listCalendars(): Promise<CalendarSource[]>;

  /**
   * Events overlapping `[startAt, endAt]` (Unix ms, at most four years apart),
   * sorted by start time. Searches every calendar unless `calendarIds` is given.
   */
  listEvents(startAt: number, endAt: number, calendarIds?: string[]): Promise<CalendarEvent[]>;

  /** Creates an event and returns it as saved. */
  createEvent(input: CreateEventInput): Promise<CalendarEvent>;

  /** Every Reminders list. */
  listReminderLists(): Promise<ReminderList[]>;

  /**
   * Reminders in `listIds` (every list when omitted). Completed reminders are
   * omitted unless `includeCompleted` is `true`.
   */
  listReminders(listIds?: string[], includeCompleted?: boolean): Promise<ReminderItem[]>;

  /** Creates a reminder and returns it as saved. */
  createReminder(input: CreateReminderInput): Promise<ReminderItem>;

  /** Marks a reminder done or not done and returns it as saved. */
  setReminderCompleted(id: string, completed: boolean): Promise<ReminderItem>;
}
