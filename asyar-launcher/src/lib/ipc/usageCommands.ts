// asyar-launcher/src/lib/ipc/usageCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe } from './invokeSafe';

// ── Usage insights ────────────────────────────────────────────────────────────

export interface UsageTopItem {
  id: string;
  label?: string | null;
  count: number;
}
export interface UsageStats {
  activeDays: number;
  totalLaunches: number;
  top: UsageTopItem[];
}
export async function getUsageStats(): Promise<UsageStats | null> {
  return invokeSafe('get_usage_stats');
}
export async function recordActiveDay(): Promise<void> {
  await invokeSafe('record_active_day');
}
export async function getUsageAnonId(): Promise<string | null> {
  return invokeSafe('get_usage_anon_id');
}
export async function resetUsageAnonId(): Promise<string | null> {
  return invokeSafe('reset_usage_anon_id');
}
export async function sendPendingUsage(day: string): Promise<void> {
  await invokeSafe('send_pending_usage', { day });
}
/** Explicit user action: send today's usage snapshot now. Returns the count of distinct launch entries sent. */
export async function sendUsageNow(): Promise<number | null> {
  return invokeSafe('send_usage_now');
}
