import { invokeSafe, invokeSafeOption } from './invokeSafe';

export interface PendingUpdate {
  version: string;
}

/**
 * `app_updater_check_now` is `Result<Option<String>, String>` — a clean
 * "up to date" (`Ok(None)`) and a failed check both serialize to `null`, so
 * this uses `invokeSafeOption` to keep the two distinguishable: callers need
 * to surface a real check failure to the user, not silently report
 * "up to date".
 */
export async function appUpdaterCheckNow(): Promise<
  { ok: true; value: string | null } | { ok: false }
> {
  return invokeSafeOption<string>('app_updater_check_now');
}

export async function appUpdaterGetPending(): Promise<PendingUpdate | null> {
  return invokeSafe<PendingUpdate>('app_updater_get_pending');
}
