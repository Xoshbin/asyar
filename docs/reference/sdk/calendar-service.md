### 8.42 `CalendarService` — Calendar events and reminders

**Runs in:** both worker and view.

**Permissions required:** four granular permissions, declare only what you use.

| Permission        | Methods                                      |
| ----------------- | -------------------------------------------- |
| `calendar:read`   | `listCalendars()`, `listEvents()`            |
| `calendar:write`  | `createEvent()`                              |
| `reminders:read`  | `listReminderLists()`, `listReminders()`     |
| `reminders:write` | `createReminder()`, `setReminderCompleted()` |

Read and create events in the user's calendars and items in their Reminders lists. Available on **macOS** through EventKit. Windows and Linux backends are not implemented yet: every call rejects with `Unsupported platform operation` so you can tell "no backend" apart from "nothing scheduled". All timestamps are Unix milliseconds.

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

| Call                   | Behavior                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listEvents`           | Events overlapping the range, sorted by start. The range may span at most four years (an EventKit limit). An unknown id in `calendarIds` rejects. |
| `createEvent`          | Rejects an empty title, `endAt` before `startAt`, an unknown or read-only calendar, or an invalid `url`.                                          |
| `listReminders`        | Incomplete reminders only unless `includeCompleted` is `true`. Sorted: open before completed, then by due date (undated last), then title.        |
| `createReminder`       | Rejects an empty title, a priority outside 0-9, or an unknown or read-only list. Due dates are stored to the second in the user's time zone.      |
| `setReminderCompleted` | Rejects if `id` is not a reminder. Returns the saved reminder.                                                                                    |

**First use (macOS):** the first events call asks the user to allow Asyar to access Calendar, and the first reminders call asks for Reminders. Asyar needs _full_ access (write-only is not enough to read). If the user denies it, calls reject with a message pointing at System Settings → Privacy & Security.

> **Pro Tip:** Calendar and Reminders are separate macOS permissions. An extension that only needs reminders should declare only the `reminders:*` permissions, so users are never asked for calendar access it does not use.

---
