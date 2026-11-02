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
 * SDK proxy for native calendar and reminders access. The host's IPC router
 * injects the calling extension's ID, which the permission gates check.
 */
export class CalendarServiceProxy extends BaseServiceProxy implements ICalendarService {
  async listCalendars(): Promise<CalendarSource[]> {
    return this.broker.invoke<CalendarSource[]>('calendar:listCalendars', {});
  }

  async listEvents(
    startAt: number,
    endAt: number,
    calendarIds?: string[],
  ): Promise<CalendarEvent[]> {
    return this.broker.invoke<CalendarEvent[]>('calendar:listEvents', {
      startAt,
      endAt,
      calendarIds: calendarIds ?? null,
    });
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    return this.broker.invoke<CalendarEvent>('calendar:createEvent', { input });
  }

  async listReminderLists(): Promise<ReminderList[]> {
    return this.broker.invoke<ReminderList[]>('calendar:listReminderLists', {});
  }

  async listReminders(listIds?: string[], includeCompleted?: boolean): Promise<ReminderItem[]> {
    return this.broker.invoke<ReminderItem[]>('calendar:listReminders', {
      listIds: listIds ?? null,
      includeCompleted: includeCompleted ?? false,
    });
  }

  async createReminder(input: CreateReminderInput): Promise<ReminderItem> {
    return this.broker.invoke<ReminderItem>('calendar:createReminder', { input });
  }

  async setReminderCompleted(id: string, completed: boolean): Promise<ReminderItem> {
    return this.broker.invoke<ReminderItem>('calendar:setReminderCompleted', { id, completed });
  }
}
