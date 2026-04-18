import { invoke } from '@tauri-apps/api/core';
import type { ScheduleTimerOptions, TimerDescriptor } from 'asyar-sdk';
import { logService } from '../log/logService';

/**
 * Host-side thin wrapper over the Rust `timer_*` Tauri commands.
 *
 * The ExtensionIpcRouter auto-injects the caller's `extensionId` (timers is
 * in `INJECTS_EXTENSION_ID`) so each method takes it as its first arg.
 * Privileged host-context callers pass `null` — though timers on `null`
 * have no iframe to fire into and the Rust layer rejects them.
 *
 * JSON-string conversion for `args` happens here so both the extension
 * (via the SDK proxy) and the launcher consumers see
 * `Record<string, unknown>`; only the SQLite row carries a string.
 */
type RawTimerRow = {
  timerId: string;
  extensionId: string;
  commandId: string;
  argsJson: string;
  fireAt: number;
  createdAt: number;
};

function parseArgs(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (e) {
    logService.warn(`[timers] argsJson parse failed, returning {}: ${(e as Error).message}`);
  }
  return {};
}

export const timerService = {
  async schedule(extensionId: string | null, opts: ScheduleTimerOptions): Promise<string> {
    const argsJson = JSON.stringify(opts.args ?? {});
    return invoke<string>('timer_schedule', {
      extensionId,
      commandId: opts.commandId,
      argsJson,
      fireAt: opts.fireAt,
    });
  },

  async cancel(extensionId: string | null, timerId: string): Promise<void> {
    return invoke<void>('timer_cancel', { extensionId, timerId });
  },

  async list(extensionId: string | null): Promise<TimerDescriptor[]> {
    const raw = await invoke<RawTimerRow[]>('timer_list', { extensionId });
    return raw.map((r) => ({
      timerId: r.timerId,
      extensionId: r.extensionId,
      commandId: r.commandId,
      args: parseArgs(r.argsJson),
      fireAt: r.fireAt,
      createdAt: r.createdAt,
    }));
  },
};
