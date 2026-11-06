import { fetchRemoteIcon } from '../../lib/ipc/commands';
import { logService } from '../log/logService';

/**
 * Resolves `https://` extension icons into `asyar-icon://` URLs.
 *
 * The webview must never point an `<img>` at an extension's URL: that would
 * leak a request (cookies, referrer, IP) outside the host's permission and
 * private-network checks. Rust fetches the bytes through the scoped network
 * path and caches a 128px copy, so this module only has to remember the
 * result and keep repeated row renders off the IPC bridge.
 */

/** Enough entries for a full result page plus the actions panel. */
const SUCCESS_CACHE_LIMIT = 512;

/** A broken icon is retried after this long instead of on every render. */
const FAILURE_TTL_MS = 60_000;

/** Same ceiling as successes, so an extension cannot grow this map unbounded. */
const FAILURE_CACHE_LIMIT = 512;

const successCache = new Map<string, string>();
const failures = new Map<string, number>();
const inFlight = new Map<string, Promise<string | null>>();

function cacheKey(extensionId: string, url: string): string {
  // The owner is part of the key so one extension can never reuse another's
  // cached icon, matching Rust's cache key.
  return `${extensionId}\u0000${url}`;
}

function rememberSuccess(key: string, iconUrl: string): void {
  if (successCache.size >= SUCCESS_CACHE_LIMIT) {
    const oldest = successCache.keys().next().value;
    if (oldest !== undefined) successCache.delete(oldest);
  }
  successCache.set(key, iconUrl);
}

function markFailure(key: string): void {
  if (failures.size >= FAILURE_CACHE_LIMIT) {
    const oldest = failures.keys().next().value;
    if (oldest !== undefined) failures.delete(oldest);
  }
  failures.set(key, Date.now() + FAILURE_TTL_MS);
}

function warnDev(message: string): void {
  if (import.meta.env.DEV) logService.warn(message);
}

/**
 * Resolves one remote icon, or returns `null` when it cannot be shown.
 *
 * Failures are cached briefly and logged once per attempt, so a row that
 * re-renders on every keystroke neither hammers the network nor spams the log.
 * A missing owner (a built-in row, a malformed action) is refused without an
 * IPC call: only a real extension can own a remote icon.
 */
export async function resolveRemoteIcon(
  extensionId: string | null | undefined,
  url: string,
): Promise<string | null> {
  if (!extensionId) {
    warnDev(`[RemoteIcon] Refusing remote icon without an owning extension: ${url}`);
    return null;
  }

  const key = cacheKey(extensionId, url);
  const cached = successCache.get(key);
  if (cached) return cached;

  const failedUntil = failures.get(key);
  if (failedUntil !== undefined) {
    if (Date.now() < failedUntil) return null;
    failures.delete(key);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const iconUrl = await fetchRemoteIcon({ extensionId, url });
      if (!iconUrl) {
        markFailure(key);
        return null;
      }
      rememberSuccess(key, iconUrl);
      return iconUrl;
    } catch (error) {
      markFailure(key);
      warnDev(`[RemoteIcon] Could not load '${url}' for ${extensionId}: ${String(error)}`);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}

/** Clears every memoised result. Exposed for tests and a full app reset. */
export function resetRemoteIconCache(): void {
  successCache.clear();
  failures.clear();
  inFlight.clear();
}
