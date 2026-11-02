import type {
  CalendarEvent,
  CalendarSource,
  CreateEventInput,
  CreateReminderInput,
  ICalendarService,
  ReminderItem,
  ReminderList,
} from './ICalendarService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * The first call can block on the macOS Calendar/Reminders permission prompt (the
 * native side waits up to 300 s), so the default 10 s IPC timeout would reject while
 * the operation is still pending and invite a duplicate on retry.
 */
const CALENDAR_TIMEOUT_MS = 310_000;

/**
 * SDK proxy for native calendar and reminders access. The host's IPC router
 * injects the calling extension's ID, which the permission gates check.
 */
export class CalendarServiceProxy extends BaseServiceProxy implements ICalendarService {
  async listCalendars(): Promise<CalendarSource[]> {
    return this.broker.invoke<CalendarSource[]>(
      'calendar:listCalendars',
      {},
      undefined,
      CALENDAR_TIMEOUT_MS,
    );
  }

  async listEvents(
    startAt: number,
    endAt: number,
    calendarIds?: string[],
  ): Promise<CalendarEvent[]> {
    return this.broker.invoke<CalendarEvent[]>(
      'calendar:listEvents',
      {
        startAt,
        endAt,
        calendarIds: calendarIds ?? null,
      },
      undefined,
      CALENDAR_TIMEOUT_MS,
    );
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    return this.broker.invoke<CalendarEvent>(
      'calendar:createEvent',
      { input },
      undefined,
      CALENDAR_TIMEOUT_MS,
    );
  }

  async listReminderLists(): Promise<ReminderList[]> {
    return this.broker.invoke<ReminderList[]>(
      'calendar:listReminderLists',
      {},
      undefined,
      CALENDAR_TIMEOUT_MS,
    );
  }

  async listReminders(listIds?: string[], includeCompleted?: boolean): Promise<ReminderItem[]> {
    return this.broker.invoke<ReminderItem[]>(
      'calendar:listReminders',
      {
        listIds: listIds ?? null,
        includeCompleted: includeCompleted ?? false,
      },
      undefined,
      CALENDAR_TIMEOUT_MS,
    );
  }

  async createReminder(input: CreateReminderInput): Promise<ReminderItem> {
    return this.broker.invoke<ReminderItem>(
      'calendar:createReminder',
      { input },
      undefined,
      CALENDAR_TIMEOUT_MS,
    );
  }

  async setReminderCompleted(id: string, completed: boolean): Promise<ReminderItem> {
    return this.broker.invoke<ReminderItem>(
      'calendar:setReminderCompleted',
      { id, completed },
      undefined,
      CALENDAR_TIMEOUT_MS,
    );
  }
}
