import { openUrl } from '@tauri-apps/plugin-opener';
import { logService } from '../log/logService';
import * as commands from '../../lib/ipc/commands';
import type { AuthUser } from '../../lib/ipc/commands';
import { appListen } from '../../lib/ipc/bridgeEvents';

/** How long (seconds) cached entitlements are considered fresh without a network refresh. */
const ENTITLEMENT_GRACE_PERIOD_SECONDS = 7 * 24 * 60 * 60; // 7 days

/** How long (ms) to poll for OAuth completion before timing out. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Polling interval (ms). */
const POLL_INTERVAL_MS = 2000;

class AuthService {
  /** Whether the user is currently authenticated. */
  public isLoggedIn = $state(false);

  /** Authenticated user profile. */
  public user = $state<AuthUser | null>(null);

  /** Cached entitlements from backend. */
  public entitlements = $state<string[]>([]);

  /** Whether a login or entitlement refresh is in progress. */
  public isLoading = $state(false);

  /** Whether the browser has been opened and we're waiting for OAuth completion. */
  public isAwaitingOAuth = $state(false);

  /** Non-fatal error string for display in UI. */
  public loginError = $state<string | null>(null);

  private deepLinkUnlisten: (() => void) | null = null;
  private authChangedUnlisten: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initialize auth on app startup.
   * Loads cached auth from Rust, registers cross-window event listeners,
   * then attempts a background entitlement refresh if logged in.
   */
  private authListeners = new Set<(isLoggedIn: boolean) => void | Promise<void>>();

  /** Subscribe to authentication state changes (login, logout, token refresh). */
  onAuthChange(listener: (isLoggedIn: boolean) => void | Promise<void>): () => void {
    this.authListeners.add(listener);
    return () => this.authListeners.delete(listener);
  }

  private async notifyAuthChange(isLoggedIn: boolean): Promise<void> {
    for (const listener of this.authListeners) {
      try {
        await listener(isLoggedIn);
      } catch (err) {
        logService.warn(`Auth: listener threw on auth change: ${err}`);
      }
    }
  }

  async init(): Promise<void> {
    if (!this.authChangedUnlisten) {
      try {
        this.authChangedUnlisten = await appListen<commands.AuthStateResponse>(
          'asyar:auth-changed',
          async (event) => {
            const payload = event.payload;
            if (!payload) return;
            if (payload.isLoggedIn) {
              this.isLoggedIn = true;
              this.user = payload.user ?? null;
              this.entitlements = payload.entitlements ?? [];
              await this.notifyAuthChange(true);
            } else {
              await this.notifyAuthChange(false);
              this.isLoggedIn = false;
              this.user = null;
              this.entitlements = [];
              this.loginError = null;
              this.isLoading = false;
            }
          },
        );
      } catch (err) {
        logService.warn(`Auth: failed to listen for asyar:auth-changed: ${err}`);
      }
    }

    try {
      const cached = await commands.authLoadCached();

      if (!cached || !cached.isLoggedIn) {
        this.isLoggedIn = false;
        this.user = null;
        this.entitlements = [];
        return;
      }

      // Populate state from cache immediately
      this.isLoggedIn = true;
      this.user = cached.user ?? null;
      this.entitlements = cached.entitlements;

      // Check if cached entitlements are stale
      const now = Math.floor(Date.now() / 1000);
      const cachedAt = cached.entitlementsCachedAt ?? 0;
      const isStale = now - cachedAt > ENTITLEMENT_GRACE_PERIOD_SECONDS;

      // Background refresh — do not await, do not block startup
      this.refreshEntitlements().catch((err) => {
        logService.warn(`Auth: background entitlement refresh failed: ${err}`);
        if (isStale) {
          // Stale + no network = clear entitlements and warn
          this.entitlements = [];
          logService.warn(
            'Auth: cached entitlements expired and refresh failed. Clearing entitlements.',
          );
        }
      });
    } catch (err) {
      logService.error(`Auth: init failed: ${err}`);
      // Non-fatal — app continues without auth
    }
  }

  /**
   * Begin the OAuth login flow:
   * 1. Get session_code + auth URL from backend
   * 2. Open the URL in the system browser
   * 3. Listen for deep link callback (asyar://auth/callback)
   * 4. On callback, poll backend to get token + user + entitlements
   */
  async startLogin(provider: string = 'github'): Promise<void> {
    if (this.isLoading || this.isAwaitingOAuth) return;

    try {
      this.isLoading = true;
      this.loginError = null;

      const initResult = await commands.authInitiate(provider);
      if (!initResult) {
        throw new Error('Server did not respond');
      }
      const { sessionCode, authUrl } = initResult;

      // Open the browser
      await openUrl(authUrl);
      this.isAwaitingOAuth = true;
      this.isLoading = false;

      // Listen for deep link: Rust emits "asyar:deep-link" with the full URL
      this.deepLinkUnlisten = await appListen<string>('asyar:deep-link', async (event) => {
        const url = event.payload;
        if (!url.startsWith('asyar://auth/callback')) return;

        this.cancelLoginPolling(); // clean up listener and timeout

        try {
          this.isLoading = true;
          await this._completePoll(sessionCode);
        } catch (err) {
          this.loginError = `Login failed: ${err}`;
          logService.error(`Auth: OAuth completion failed: ${err}`);
        } finally {
          this.isLoading = false;
          this.isAwaitingOAuth = false;
        }
      });

      // Fallback polling — in case deep link doesn't fire (e.g. no browser redirect)
      this._startFallbackPolling(sessionCode);

      // Timeout
      this.pollTimeout = setTimeout(() => {
        this.cancelLoginPolling();
        this.isAwaitingOAuth = false;
        this.loginError = 'Login timed out. Please try again.';
      }, POLL_TIMEOUT_MS);
    } catch (err) {
      this.isLoading = false;
      this.isAwaitingOAuth = false;
      this.loginError = `Could not start login: ${err}`;
      logService.error(`Auth: startLogin failed: ${err}`);
    }
  }

  /** Cancel any in-progress login (e.g. user clicks Cancel). */
  cancelLoginPolling(): void {
    if (this.deepLinkUnlisten) {
      this.deepLinkUnlisten();
      this.deepLinkUnlisten = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    this.isAwaitingOAuth = false;
  }

  /** Fetch fresh entitlements from backend and update reactive state + disk cache. */
  async refreshEntitlements(): Promise<void> {
    if (!this.isLoggedIn) return;
    const fresh = await commands.authRefreshEntitlements();
    this.entitlements = fresh;
  }

  /** Sign out: revoke token on backend, clear all local state. */
  async logout(): Promise<void> {
    try {
      this.isLoading = true;
      await commands.authLogout();
    } catch (err) {
      // Best-effort — proceed with local logout even if revocation fails
      logService.warn(`Auth: logout revocation failed: ${err}`);
    } finally {
      // Stop the cloud-sync periodic timer + provider change subscriptions
      // before clearing auth state, so an in-flight syncNow() can't fire
      // again post-logout (the entitlement gate inside syncNow would reject
      // it, but that surfaces a misleading `lastError`).
      await this.notifyAuthChange(false);

      this.isLoggedIn = false;
      this.user = null;
      this.entitlements = [];
      this.loginError = null;
      this.isLoading = false;
    }
  }

  /** Poll backend until status = complete or expired. Used as fallback when deep link fires. */
  private _startFallbackPolling(sessionCode: string): void {
    this.pollTimer = setInterval(async () => {
      const result = await commands.authPoll(sessionCode).catch(() => null);
      // A transient poll failure is already diagnosed centrally; retry next tick.
      if (result === null) return;
      if (result.status === 'complete' || result.status === 'expired') {
        this.cancelLoginPolling();
        if (result.status === 'complete') {
          await this._applyPollResult(result);
        } else {
          this.loginError = 'Login session expired. Please try again.';
          this.isAwaitingOAuth = false;
        }
      }
    }, POLL_INTERVAL_MS);
  }

  /** Complete login after deep link fires — do one final poll to get the full payload. */
  private async _completePoll(sessionCode: string): Promise<void> {
    // The deep link signals completion — do one direct poll for the payload
    const result = await commands.authPoll(sessionCode).catch(() => null);
    if (result === null || result.status !== 'complete') {
      // Try once more (network race)
      await new Promise((r) => setTimeout(r, 500));
      const retry = await commands.authPoll(sessionCode);
      if (retry.status !== 'complete') {
        throw new Error('OAuth completed but session data not ready');
      }
      await this._applyPollResult(retry);
      return;
    }
    await this._applyPollResult(result);
  }

  /** Apply a successful poll result to reactive state. */
  private async _applyPollResult(result: commands.PollResponse): Promise<void> {
    if (result.user) this.user = result.user;
    if (result.entitlements) this.entitlements = result.entitlements;
    this.isLoggedIn = true;
    logService.info(`Auth: logged in as ${result.user?.email ?? 'unknown'}`);

    await this.notifyAuthChange(true);
  }
}

export const authService = new AuthService();
