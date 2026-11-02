import type {
  CalendarEvent,
  CalendarSource,
  CreateEventInput,
  CreateReminderInput,
  ReminderItem,
  ReminderList,
} from 'asyar-sdk/contracts';
import {
  calendarListCalendars,
  calendarListEvents,
  calendarCreateEvent,
  calendarListReminderLists,
  calendarListReminders,
  calendarCreateReminder,
  calendarSetReminderCompleted,
} from '../../lib/ipc/systemCommands';

/**
 * Host-side thin wrapper over the Rust `calendar_*` Tauri commands.
 *
 * The ExtensionIpcRouter auto-injects the caller's `extensionId` (see
 * `INJECTS_EXTENSION_ID`) as the first arg; privileged host calls pass `null`.
 */
export const calendarService = {
  async listCalendars(extensionId: string | null): Promise<CalendarSource[]> {
    return calendarListCalendars(extensionId);
  },
  async listEvents(
    extensionId: string | null,
    startAt: number,
    endAt: number,
    calendarIds?: string[] | null,
  ): Promise<CalendarEvent[]> {
    return calendarListEvents(extensionId, startAt, endAt, calendarIds ?? null);
  },
  async createEvent(extensionId: string | null, input: CreateEventInput): Promise<CalendarEvent> {
    return calendarCreateEvent(extensionId, input);
  },
  async listReminderLists(extensionId: string | null): Promise<ReminderList[]> {
    return calendarListReminderLists(extensionId);
  },
  async listReminders(
    extensionId: string | null,
    listIds?: string[] | null,
    includeCompleted?: boolean,
  ): Promise<ReminderItem[]> {
    return calendarListReminders(extensionId, listIds ?? null, includeCompleted ?? false);
  },
  async createReminder(
    extensionId: string | null,
    input: CreateReminderInput,
  ): Promise<ReminderItem> {
    return calendarCreateReminder(extensionId, input);
  },
  async setReminderCompleted(
    extensionId: string | null,
    id: string,
    completed: boolean,
  ): Promise<ReminderItem> {
    return calendarSetReminderCompleted(extensionId, id, completed);
  },
};
