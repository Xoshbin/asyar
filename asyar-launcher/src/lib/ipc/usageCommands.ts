import { logService } from '../../services/log/logService';
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
export async function getUsageStats(): Promise<UsageStats> {
  return invokeSafe('get_usage_stats');
}
export async function recordActiveDay(): Promise<void> {
  try {
    await invokeSafe('record_active_day', undefined, { silent: true });
  } catch (err) {
    logService.debug(`[usage] recordActiveDay failed silently: ${err}`);
  }
}
export async function getUsageAnonId(): Promise<string> {
  return invokeSafe('get_usage_anon_id');
}
export async function resetUsageAnonId(): Promise<string> {
  return invokeSafe('reset_usage_anon_id');
}
export async function sendPendingUsage(day: string): Promise<void> {
  await invokeSafe('send_pending_usage', { day });
}
/** Explicit user action: send today's usage snapshot now. Returns the count of distinct launch entries sent. */
export async function sendUsageNow(): Promise<number> {
  return invokeSafe('send_usage_now');
}

/** Local daily compatibility counts; never included in usage network payloads. */
export async function recordWorkerFallback(extensionId: string): Promise<void> {
  try {
    await invokeSafe('record_worker_fallback', { extensionId }, { silent: true });
  } catch (err) {
    logService.debug(`[usage] recordWorkerFallback failed silently: ${err}`);
  }
}
