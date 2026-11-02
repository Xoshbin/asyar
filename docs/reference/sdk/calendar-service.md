### 8.42 `CalendarService` — Calendar events and reminders

**Runs in:** both worker and view.

**Permissions required:** four granular permissions, declare only what you use.

| Permission        | Methods                                      |
| ----------------- | -------------------------------------------- |
| `calendar:read`   | `listCalendars()`, `listEvents()`            |
| `calendar:write`  | `createEvent()`                              |
| `reminders:read`  | `listReminderLists()`, `listReminders()`     |
| `reminders:write` | `createReminder()`, `setReminderCompleted()` |

Read and create events in the user's calendars and items in their Reminders lists. Available on **macOS** (EventKit), **Linux** (local `.ics` files) and **Windows** (WinRT appointments, calendar only). A call a platform cannot serve rejects with `Unsupported platform operation`, so you can tell "no backend" apart from "nothing scheduled". All timestamps are Unix milliseconds.

| Platform | Calendar events                                                                 | Reminders                                  |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| macOS    | EventKit: every calendar the user has                                           | EventKit Reminders lists                   |
| Linux    | `VEVENT` in local `.ics` files                                                  | `VTODO` in the same `.ics` files           |
| Windows  | WinRT `Appointments`: calendars of signed-in accounts; writes go to Asyar's own | Not available; every reminder call rejects |

```typescript
interface CalendarSource {
  id: string;
  title: string;
  sourceTitle: string | null; // account, e.g. "iCloud"
  readOnly: boolean;
}

interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarTitle: string;
  title: string;
  startAt: number;
  endAt: number;
  isAllDay: boolean;
  location: string | null;
  notes: string | null;
  url: string | null;
}

interface CreateEventInput {
  calendarId?: string; // default: the user's default calendar
  title: string;
  startAt: number;
  endAt: number; // not before startAt
  isAllDay?: boolean;
  location?: string;
  notes?: string;
  url?: string;
}

interface ReminderList {
  id: string;
  title: string;
  sourceTitle: string | null;
  readOnly: boolean;
}

interface ReminderItem {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  isCompleted: boolean;
  dueAt: number | null;
  priority: number; // 0 none, 1-4 high, 5 medium, 6-9 low
  notes: string | null;
}

interface CreateReminderInput {
  listId?: string; // default: the user's default list
  title: string;
  dueAt?: number;
  priority?: number; // 0-9
  notes?: string;
}

interface ICalendarService {
  listCalendars(): Promise<CalendarSource[]>;
  listEvents(startAt: number, endAt: number, calendarIds?: string[]): Promise<CalendarEvent[]>;
  createEvent(input: CreateEventInput): Promise<CalendarEvent>;
  listReminderLists(): Promise<ReminderList[]>;
  listReminders(listIds?: string[], includeCompleted?: boolean): Promise<ReminderItem[]>;
  createReminder(input: CreateReminderInput): Promise<ReminderItem>;
  setReminderCompleted(id: string, completed: boolean): Promise<ReminderItem>;
}
```

**Manifest declaration:**

```json
{
  "permissions": ["calendar:read", "calendar:write", "reminders:read", "reminders:write"]
}
```

**Usage — today's agenda:**

```typescript
const calendar = context.getService<ICalendarService>('calendar');

const now = Date.now();
const endOfDay = new Date().setHours(23, 59, 59, 999);
for (const e of await calendar.listEvents(now, endOfDay)) {
  console.log(`${new Date(e.startAt).toLocaleTimeString()} ${e.title} (${e.calendarTitle})`);
}
```

**Usage — add an event and a reminder:**

```typescript
await calendar.createEvent({
  title: 'Design review',
  startAt: Date.parse('2026-11-05T15:00:00'),
  endAt: Date.parse('2026-11-05T15:45:00'),
  location: 'Room 4',
});

const reminder = await calendar.createReminder({
  title: 'Send notes',
  dueAt: Date.now() + 3_600_000,
});
await calendar.setReminderCompleted(reminder.id, true);
```

**Semantics:**

| Call                   | Behavior                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listEvents`           | Events overlapping the range, sorted by start. The range may span at most four years (an EventKit limit). An unknown id in `calendarIds` rejects.                                                                                                                                                           |
| `createEvent`          | Rejects an empty title, `endAt` before `startAt`, an unknown or read-only calendar, or a `url` the platform rejects. macOS rejects unparseable URLs; Linux only rejects control characters and writes any other value as-is, so validate the URL yourself.                                                  |
| `listReminders`        | Incomplete reminders only unless `includeCompleted` is `true`. Sorted: open before completed, then by due date (undated last), then title.                                                                                                                                                                  |
| `createReminder`       | Rejects an empty title, a priority outside 0-9, or an unknown or read-only list. `dueAt` is an absolute instant (Unix ms) on every platform; macOS stores date components in the user's time zone and Linux writes a UTC `DUE` value, with whole-second precision on both, so sub-second parts are dropped. |
| `setReminderCompleted` | Rejects if `id` is not a reminder. Returns the saved reminder.                                                                                                                                                                                                                                              |

**Linux (`.ics` files):** there is no system calendar API, so Asyar reads and writes plain iCalendar files, each file being one calendar and one Reminders list. It looks in `$XDG_DATA_HOME/asyar/calendars/`, `$XDG_DATA_HOME/evolution/calendar/system/calendar.ics` and `$XDG_DATA_HOME/calendars/*.ics` (`XDG_DATA_HOME` defaults to `~/.local/share`). New items go to the first writable file, or to a `default.ics` that Asyar creates in its own directory. The Evolution calendar is listed read-only because Evolution Data Server owns that file. There is no permission prompt. Limits: times are read as UTC (floating and `TZID` times are not converted), recurring events are not expanded and appear once at their first occurrence, and edits are written straight to the file, so a sync tool that rewrites it concurrently can overwrite them.

**Windows (WinRT):** `listCalendars` and `listEvents` read every calendar of the accounts signed in to Windows (Outlook, Google, …). WinRT only lets an app write to calendars it created, so `createEvent` saves to an "Asyar" calendar (created on first use) and rejects any other `calendarId` as not writable. Windows has no Reminders store: `listReminderLists`, `listReminders`, `createReminder` and `setReminderCompleted` always reject. WinRT appointment access can require a packaged app, so treat Windows as best-effort until verified on a real install.

**First use (macOS):** the first events call asks the user to allow Asyar to access Calendar, and the first reminders call asks for Reminders. Asyar needs _full_ access (write-only is not enough to read). If the user denies it, calls reject with a message pointing at System Settings → Privacy & Security.

> **Pro Tip:** Calendar and Reminders are separate macOS permissions (and Windows has no reminders at all). An extension that only needs reminders should declare only the `reminders:*` permissions, so users are never asked for calendar access it does not use.

---
