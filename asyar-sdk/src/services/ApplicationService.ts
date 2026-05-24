import type { InstalledApplication } from '../types/ApplicationType';
import { BaseServiceProxy } from './BaseServiceProxy';

export interface FrontmostApplication {
  name: string;
  bundleId?: string;
  path?: string;
  windowTitle?: string;
}

/**
 * Push event delivered by the app-events service. The `type` discriminant
 * matches the Rust wire format (kebab-case).
 */
export type AppPresenceEvent =
  | {
      type: 'launched';
      pid: number;
      bundleId?: string;
      name: string;
      path?: string;
    }
  | {
      type: 'terminated';
      pid: number;
      bundleId?: string;
      name: string;
    }
  | {
      type: 'frontmost-changed';
      pid: number;
      bundleId?: string;
      name: string;
    };

export type AppPresenceEventKind = AppPresenceEvent['type'];

/**
 * Push event fired when the on-disk set of installed applications changes
 * — either because the user installed/uninstalled an app in a watched
 * default directory or because they edited a user-configured scan path.
 *
 * Payload shape matches the Rust `SyncResult`: `added` and `removed` are
 * the diff relative to the previous scan; `total` is the current absolute
 * count. No-op rescans (both zero) are suppressed by the host and never
 * reach subscribers.
 */
export type ApplicationIndexEvent = {
  type: 'applications-changed';
  added: number;
  removed: number;
  total: number;
};

export type ApplicationIndexEventKind = ApplicationIndexEvent['type'];

/**
 * Disposer returned by every `on*` subscription. Invoke it once to
 * unsubscribe — calling it more than once is a safe no-op.
 */
export type Disposer = () => void;

export interface IApplicationService {
  /**
   * Retrieves metadata about the currently focused application.
   * Requires 'application:read' permission.
   */
  getFrontmostApplication(): Promise<FrontmostApplication>;

  /**
   * Scans for applications in default and extra paths.
   * Only useful for extensions that manage application indexing.
   * Requires 'application:read' permission.
   */
  syncApplicationIndex(extraPaths?: string[]): Promise<{ added: number; removed: number; total: number }>;

  /**
   * Lists all installed applications.
   * Requires 'application:read' permission.
   */
  listApplications(extraPaths?: string[]): Promise<InstalledApplication[]>;

  /**
   * Synchronous-feeling presence check: is an application with this bundle
   * identifier (macOS) / process name (Linux/Windows) currently running?
   * Requires 'application:read' permission.
   */
  isRunning(bundleId: string): Promise<boolean>;

  /**
   * Register a callback fired every time a GUI application is launched.
   * Returns a [`Disposer`] — invoke it to unsubscribe.
   * Requires 'app:frontmost-watch' permission.
   */
  onApplicationLaunched(
    cb: (e: Extract<AppPresenceEvent, { type: 'launched' }>) => void,
  ): Disposer;

  /**
   * Register a callback fired every time a GUI application terminates.
   * Requires 'app:frontmost-watch' permission.
   */
  onApplicationTerminated(
    cb: (e: Extract<AppPresenceEvent, { type: 'terminated' }>) => void,
  ): Disposer;

  /**
   * Register a callback fired every time the OS frontmost application
   * changes. Requires 'app:frontmost-watch' permission.
   *
   * Platform coverage:
   * - macOS: full support via `NSWorkspaceDidActivateApplicationNotification`
   * - Windows: full support via `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`
   * - Linux (X11): supported via `_NET_ACTIVE_WINDOW`
   * - Linux (Wayland): not supported — one warning logged, no events
   */
  onFrontmostApplicationChanged(
    cb: (e: Extract<AppPresenceEvent, { type: 'frontmost-changed' }>) => void,
  ): Disposer;

  /**
   * Register a callback fired every time the installed-application index
   * changes on disk — e.g. a new app is installed to `/Applications`, an
   * existing app is removed, or the user edits a directory in
   * `settings.search.additionalScanPaths`. The host debounces filesystem
   * events (default 500ms) and suppresses no-op rescans, so each
   * callback invocation represents a real change.
   *
   * Returns a [`Disposer`] — invoke it to unsubscribe.
   * Requires 'application:read' permission (same as `listApplications` —
   * this event carries the same data class).
   */
  onApplicationsChanged(
    cb: (e: ApplicationIndexEvent) => void,
  ): Disposer;
}

interface PerKindState {
  subscriptionIdPromise: Promise<string>;
  callbacks: Set<(ev: AppPresenceEvent) => void>;
}

interface IndexPerKindState {
  subscriptionIdPromise: Promise<string>;
  callbacks: Set<(ev: ApplicationIndexEvent) => void>;
}

/**
 * SDK-side proxy for `ApplicationService` + the new push-event surface.
 *
 * ### Namespace split
 *
 * The existing query methods (`getFrontmostApplication`,
 * `syncApplicationIndex`, `listApplications`, `isRunning`) all invoke on
 * the `application:*` namespace because they're one-shot request/response.
 *
 * The new subscription surface (`onApplicationLaunched`,
 * `onApplicationTerminated`, `onFrontmostApplicationChanged`) invokes on
 * the dedicated `appEvents:*` namespace. Subscription lifecycle is distinct
 * from the query surface — the `app:frontmost-watch` permission gates only
 * `appEvents:*`; `application:*` continues to require `application:read`.
 *
 * ### Ref-counted subscriptions
 *
 * Each `on*` method uses the same ref-counting pattern as
 * `SystemEventsServiceProxy`: the first listener for a given kind issues
 * one `appEvents:subscribe` RPC; subsequent listeners on the same kind
 * reuse the in-flight subscription. When the last listener for a kind is
 * disposed, one `appEvents:unsubscribe` RPC fires.
 */
export class ApplicationServiceProxy extends BaseServiceProxy implements IApplicationService {
  private states = new Map<AppPresenceEventKind, PerKindState>();
  private pushListenerInstalled = false;
  private indexStates = new Map<ApplicationIndexEventKind, IndexPerKindState>();
  private indexPushListenerInstalled = false;

  async getFrontmostApplication(): Promise<FrontmostApplication> {
    return await this.broker.invoke('application:getFrontmostApplication');
  }

  async syncApplicationIndex(extraPaths?: string[]): Promise<{ added: number; removed: number; total: number }> {
    return await this.broker.invoke('application:syncApplicationIndex', { extraPaths });
  }

  async listApplications(extraPaths?: string[]): Promise<InstalledApplication[]> {
    return await this.broker.invoke<InstalledApplication[]>('application:listApplications', { extraPaths });
  }

  async isRunning(bundleId: string): Promise<boolean> {
    return await this.broker.invoke<boolean>('application:isRunning', { bundleId });
  }

  onApplicationLaunched(
    cb: (e: Extract<AppPresenceEvent, { type: 'launched' }>) => void,
  ): Disposer {
    return this.listen<Extract<AppPresenceEvent, { type: 'launched' }>>('launched', cb);
  }

  onApplicationTerminated(
    cb: (e: Extract<AppPresenceEvent, { type: 'terminated' }>) => void,
  ): Disposer {
    return this.listen<Extract<AppPresenceEvent, { type: 'terminated' }>>(
      'terminated',
      cb,
    );
  }

  onFrontmostApplicationChanged(
    cb: (e: Extract<AppPresenceEvent, { type: 'frontmost-changed' }>) => void,
  ): Disposer {
    return this.listen<Extract<AppPresenceEvent, { type: 'frontmost-changed' }>>(
      'frontmost-changed',
      cb,
    );
  }

  onApplicationsChanged(cb: (e: ApplicationIndexEvent) => void): Disposer {
    return this.listenIndex('applications-changed', cb);
  }

  private ensurePushListener(): void {
    if (this.pushListenerInstalled) return;
    this.pushListenerInstalled = true;
    this.broker.on('asyar:event:app-event:push', (payload: unknown) => {
      if (!payload || typeof payload !== 'object' || !('type' in payload)) return;
      const ev = payload as AppPresenceEvent;
      const state = this.states.get(ev.type);
      if (!state) return;
      for (const cb of state.callbacks) {
        try {
          cb(ev);
        } catch {
          // One bad callback must not prevent the rest from firing.
        }
      }
    });
  }

  private listen<T extends AppPresenceEvent>(
    kind: AppPresenceEventKind,
    dispatch: (ev: T) => void,
  ): Disposer {
    this.ensurePushListener();
    let state = this.states.get(kind);
    if (!state) {
      const subscriptionIdPromise = this.broker.invoke<string>(
        'appEvents:subscribe',
        { eventTypes: [kind] },
      );
      state = { subscriptionIdPromise, callbacks: new Set() };
      this.states.set(kind, state);
    }
    const wrapped = (ev: AppPresenceEvent) => dispatch(ev as T);
    state.callbacks.add(wrapped);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const s = this.states.get(kind);
      if (!s) return;
      s.callbacks.delete(wrapped);
      if (s.callbacks.size === 0) {
        this.states.delete(kind);
        s.subscriptionIdPromise
          .then((id) =>
            this.broker.invoke<void>('appEvents:unsubscribe', {
              subscriptionId: id,
            }),
          )
          .catch(() => {
            // Subscribe failed; nothing to unsubscribe.
          });
      }
    };
  }

  /**
   * Index-event analog of [`ensurePushListener`]. Attaches one
   * `asyar:event:application-index:push` listener for the lifetime of the
   * proxy; the listener fans the payload out to the per-kind callback set.
   */
  private ensureIndexPushListener(): void {
    if (this.indexPushListenerInstalled) return;
    this.indexPushListenerInstalled = true;
    this.broker.on('asyar:event:application-index:push', (payload: unknown) => {
      if (!payload || typeof payload !== 'object' || !('type' in payload)) return;
      const ev = payload as ApplicationIndexEvent;
      const state = this.indexStates.get(ev.type);
      if (!state) return;
      for (const cb of state.callbacks) {
        try {
          cb(ev);
        } catch {
          // One bad callback must not prevent the rest from firing.
        }
      }
    });
  }

  /**
   * Ref-counted subscribe on the `applicationIndex:*` namespace. Same
   * shape as [`listen`] but keyed on [`ApplicationIndexEventKind`] so the
   * index and presence surfaces don't share state.
   */
  private listenIndex(
    kind: ApplicationIndexEventKind,
    dispatch: (ev: ApplicationIndexEvent) => void,
  ): Disposer {
    this.ensureIndexPushListener();
    let state = this.indexStates.get(kind);
    if (!state) {
      const subscriptionIdPromise = this.broker.invoke<string>(
        'applicationIndex:subscribe',
        { eventTypes: [kind] },
      );
      state = { subscriptionIdPromise, callbacks: new Set() };
      this.indexStates.set(kind, state);
    }
    state.callbacks.add(dispatch);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const s = this.indexStates.get(kind);
      if (!s) return;
      s.callbacks.delete(dispatch);
      if (s.callbacks.size === 0) {
        this.indexStates.delete(kind);
        s.subscriptionIdPromise
          .then((id) =>
            this.broker.invoke<void>('applicationIndex:unsubscribe', {
              subscriptionId: id,
            }),
          )
          .catch(() => {
            // Subscribe failed; nothing to unsubscribe.
          });
      }
    };
  }
}
