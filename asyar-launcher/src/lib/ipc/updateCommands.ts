import { invokeSafe } from './invokeSafe';

export interface PendingUpdate {
  version: string;
}

/**
 * `app_updater_check_now` is `Result<Option<String>, String>` — a clean
 * "up to date" (`Ok(None)`) resolves `null`; a failed check rejects with an
 * `IpcError`, so callers can surface failure without conflating the two.
 */
export async function appUpdaterCheckNow(): Promise<string | null> {
  return invokeSafe<string | null>('app_updater_check_now');
}

export async function appUpdaterGetPending(): Promise<PendingUpdate | null> {
  return invokeSafe<PendingUpdate>('app_updater_get_pending');
}
