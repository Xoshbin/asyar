import { invokeSafe, invokeSafeVoid } from './invokeSafe';
import type {
  ScheduleTimerOptions,
  TimerDescriptor,
  KeepAwakeOptions,
  ActiveInhibitor,
  AppGroup,
  KillResult,
  ProcessSortBy,
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
): Promise<string | null> {
  return invokeSafe<string>('timer_schedule', { extensionId, commandId, argsJson, fireAt });
}

export async function timerCancel(extensionId: string | null, timerId: string): Promise<boolean> {
  return invokeSafeVoid('timer_cancel', { extensionId, timerId });
}

export async function timerList(extensionId: string | null): Promise<RawTimerRow[] | null> {
  return invokeSafe<RawTimerRow[]>('timer_list', { extensionId });
}

export async function powerKeepAwake(
  extensionId: string | null,
  options: KeepAwakeOptions,
): Promise<string | null> {
  return invokeSafe<string>('power_keep_awake', { extensionId, options });
}

export async function powerRelease(extensionId: string | null, token: string): Promise<boolean> {
  return invokeSafeVoid('power_release', { extensionId, token });
}

export async function powerList(extensionId: string | null): Promise<ActiveInhibitor[] | null> {
  return invokeSafe<ActiveInhibitor[]>('power_list', { extensionId });
}

export async function systemEventsSubscribe(
  extensionId: string | null,
  eventTypes: string[],
): Promise<string | null> {
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
): Promise<AppGroup[] | null> {
  return invokeSafe<AppGroup[]>('process_list', { extensionId, query, sortBy });
}

export async function processKillCommand(
  extensionId: string | null,
  pids: number[],
  force: boolean,
  confirmedProtected: boolean,
): Promise<KillResult | null> {
  return invokeSafe<KillResult>('process_kill', { extensionId, pids, force, confirmedProtected });
}

export async function fsWatchCreate(
  extensionId: string | null,
  paths: string[],
  opts: { recursive?: boolean; debounceMs?: number } | null = null,
): Promise<string | null> {
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
): Promise<string | null> {
  return invokeSafe<string>('app_events_subscribe', { extensionId, eventTypes });
}

export async function appEventsUnsubscribe(
  extensionId: string | null,
  subscriptionId: string,
): Promise<boolean> {
  return invokeSafeVoid('app_events_unsubscribe', { extensionId, subscriptionId });
}

export type { ScheduleTimerOptions, TimerDescriptor };
