import { invokeSafe, invokeSafeVoid } from './invokeSafe';
import type {
  ScheduleTimerOptions,
  TimerDescriptor,
  KeepAwakeOptions,
  MediaSessionInfo,
  CalendarEvent,
  CalendarSource,
  ShortcutInfo,
  CreateEventInput,
  CreateReminderInput,
  ReminderItem,
  ReminderList,
  MediaTransportAction,
  ActiveInhibitor,
  AppGroup,
  KillResult,
  ProcessSortBy,
  PickedColor,
} from 'asyar-sdk/contracts';

type RawTimerRow = {
  timerId: string;
  extensionId: string;
  commandId: string;
  argsJson: string;
  fireAt: number;
  createdAt: number;
};

export async function timerSchedule(
  extensionId: string | null,
  commandId: string,
  argsJson: string,
  fireAt: number,
): Promise<string> {
  return invokeSafe<string>('timer_schedule', { extensionId, commandId, argsJson, fireAt });
}

export async function timerCancel(extensionId: string | null, timerId: string): Promise<boolean> {
  return invokeSafeVoid('timer_cancel', { extensionId, timerId });
}

export async function timerList(extensionId: string | null): Promise<RawTimerRow[]> {
  return invokeSafe<RawTimerRow[]>('timer_list', { extensionId });
}

export async function powerKeepAwake(
  extensionId: string | null,
  options: KeepAwakeOptions,
): Promise<string> {
  return invokeSafe<string>('power_keep_awake', { extensionId, options });
}

export async function powerRelease(extensionId: string | null, token: string): Promise<boolean> {
  return invokeSafeVoid('power_release', { extensionId, token });
}

export async function powerList(extensionId: string | null): Promise<ActiveInhibitor[]> {
  return invokeSafe<ActiveInhibitor[]>('power_list', { extensionId });
}

export async function mediaGetNowPlaying(
  extensionId: string | null,
  playerId: string | null,
): Promise<MediaSessionInfo | null> {
  return invokeSafe<MediaSessionInfo | null>('media_get_now_playing', { extensionId, playerId });
}

export async function mediaListSessions(extensionId: string | null): Promise<MediaSessionInfo[]> {
  return invokeSafe<MediaSessionInfo[]>('media_list_sessions', { extensionId });
}

export async function mediaControl(
  extensionId: string | null,
  action: MediaTransportAction,
  playerId: string | null,
): Promise<boolean> {
  return invokeSafeVoid('media_control', { extensionId, action, playerId });
}

export async function calendarListCalendars(extensionId: string | null): Promise<CalendarSource[]> {
  return invokeSafe<CalendarSource[]>('calendar_list_calendars', { extensionId });
}

export async function calendarListEvents(
  extensionId: string | null,
  startAt: number,
  endAt: number,
  calendarIds: string[] | null,
): Promise<CalendarEvent[]> {
  return invokeSafe<CalendarEvent[]>('calendar_list_events', {
    extensionId,
    startAt,
    endAt,
    calendarIds,
  });
}

export async function calendarCreateEvent(
  extensionId: string | null,
  input: CreateEventInput,
): Promise<CalendarEvent> {
  return invokeSafe<CalendarEvent>('calendar_create_event', { extensionId, input });
}

export async function calendarListReminderLists(
  extensionId: string | null,
): Promise<ReminderList[]> {
  return invokeSafe<ReminderList[]>('calendar_list_reminder_lists', { extensionId });
}

export async function calendarListReminders(
  extensionId: string | null,
  listIds: string[] | null,
  includeCompleted: boolean,
): Promise<ReminderItem[]> {
  return invokeSafe<ReminderItem[]>('calendar_list_reminders', {
    extensionId,
    listIds,
    includeCompleted,
  });
}

export async function calendarCreateReminder(
  extensionId: string | null,
  input: CreateReminderInput,
): Promise<ReminderItem> {
  return invokeSafe<ReminderItem>('calendar_create_reminder', { extensionId, input });
}

export async function calendarSetReminderCompleted(
  extensionId: string | null,
  id: string,
  completed: boolean,
): Promise<ReminderItem> {
  return invokeSafe<ReminderItem>('calendar_set_reminder_completed', {
    extensionId,
    id,
    completed,
  });
}

export async function screenPickColor(extensionId: string | null): Promise<PickedColor | null> {
  return invokeSafe<PickedColor | null>('screen_pick_color', { extensionId });
}

export async function systemEventsSubscribe(
  extensionId: string | null,
  eventTypes: string[],
): Promise<string> {
  return invokeSafe<string>('system_events_subscribe', { extensionId, eventTypes });
}

export async function systemEventsUnsubscribe(
  extensionId: string | null,
  subscriptionId: string,
): Promise<boolean> {
  return invokeSafeVoid('system_events_unsubscribe', { extensionId, subscriptionId });
}

export async function processListCommand(
  extensionId: string | null,
  query: string | undefined,
  sortBy: ProcessSortBy,
): Promise<AppGroup[]> {
  return invokeSafe<AppGroup[]>('process_list', { extensionId, query, sortBy });
}

export async function processKillCommand(
  extensionId: string | null,
  pids: number[],
  force: boolean,
  confirmedProtected: boolean,
): Promise<KillResult> {
  return invokeSafe<KillResult>('process_kill', { extensionId, pids, force, confirmedProtected });
}

export async function fsWatchCreate(
  extensionId: string | null,
  paths: string[],
  opts: { recursive?: boolean; debounceMs?: number } | null = null,
): Promise<string> {
  return invokeSafe<string>('fs_watch_create', { extensionId, paths, opts });
}

export async function fsWatchDispose(
  extensionId: string | null,
  handleId: string,
): Promise<boolean> {
  return invokeSafeVoid('fs_watch_dispose', { extensionId, handleId });
}

export async function appEventsSubscribe(
  extensionId: string | null,
  eventTypes: string[],
): Promise<string> {
  return invokeSafe<string>('app_events_subscribe', { extensionId, eventTypes });
}

export async function appEventsUnsubscribe(
  extensionId: string | null,
  subscriptionId: string,
): Promise<boolean> {
  return invokeSafeVoid('app_events_unsubscribe', { extensionId, subscriptionId });
}

export async function wsConnect(
  socketId: string,
  url: string,
  headers: Record<string, string> | undefined,
  callerExtensionId: string | null,
  originRole: 'view' | 'worker' | undefined,
): Promise<boolean> {
  return invokeSafeVoid('ws_connect', {
    request: { socketId, url, headers, callerExtensionId, originRole },
  });
}

export async function wsSend(
  socketId: string,
  message: string,
  callerExtensionId: string | null,
): Promise<boolean> {
  return invokeSafeVoid('ws_send', { socketId, message, callerExtensionId });
}

export async function wsClose(
  socketId: string,
  code: number | undefined,
  reason: string | undefined,
  callerExtensionId: string | null,
): Promise<boolean> {
  return invokeSafeVoid('ws_close', { socketId, code, reason, callerExtensionId });
}

export type { ScheduleTimerOptions, TimerDescriptor };

export async function shortcutsList(extensionId: string | null): Promise<ShortcutInfo[]> {
  return invokeSafe<ShortcutInfo[]>('shortcuts_list', { extensionId });
}

export async function shortcutsRun(
  extensionId: string | null,
  idOrName: string,
  input: string | null,
): Promise<string> {
  return invokeSafe<string>('shortcuts_run', { extensionId, idOrName, input });
}
