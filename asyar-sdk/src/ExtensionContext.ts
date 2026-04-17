import type { ExtensionSyncProvider } from "./types/SyncType";
import type { ExtensionAction } from "./types/ActionType";
import type { CommandHandler } from "./types/CommandType";
import type { Namespace } from "./ipc/namespaces";
import type { BaseServiceProxy } from "./services/BaseServiceProxy";
import {
  LogServiceProxy,
  NotificationServiceProxy,
  ClipboardHistoryServiceProxy,
  ExtensionManagerProxy,
  CommandServiceProxy,
  ActionServiceProxy,
  NetworkServiceProxy,
  SettingsServiceProxy,
  StatusBarServiceProxy,
  EntitlementServiceProxy,
  StorageServiceProxy,
  FeedbackServiceProxy,
  SelectionServiceProxy,
  ShellServiceProxy,
  CacheServiceProxy,
  ApplicationServiceProxy,
} from "./services";
import { AIServiceProxy } from './services/AIServiceProxy';
import { OAuthServiceProxy } from './services/OAuthServiceProxy';
import { FileManagerServiceProxy } from './services/FileManagerServiceProxy';
import { InteropServiceProxy } from './services/InteropServiceProxy';
import { WindowManagementServiceProxy } from './services/WindowManagementService';
import { PowerServiceProxy } from './services/PowerServiceProxy';
import { SystemEventsServiceProxy } from './services/SystemEventsServiceProxy';

import { PreferencesFacade, buildFrozenSnapshot, type PreferencesSnapshot } from './PreferencesFacade';
export { PreferencesFacade, type PreferencesSnapshot } from './PreferencesFacade';
import { setupFocusTracking } from './lib/focusTracker';
import { setupThemeInjection } from './lib/themeInjector';
import { registerSyncProvider as setupSyncProvider } from './lib/syncProviderBridge';
export { injectThemeVariables, injectFontFaceCSS } from './lib/themeInjector';

// Define the context that will be passed to extensions
export class ExtensionContext {
  private extensionId: string = "";
  public readonly preferences: PreferencesFacade = new PreferencesFacade();

  /**
   * Listeners notified *after* `setPreferences` installs a new frozen
   * snapshot. Callbacks take no arguments and must re-read fresh values
   * from `context.preferences.values` — the snapshot is already in place
   * when they fire. This is a read-only notification, not a live getter:
   * extensions that cache preference values at boot subscribe here to
   * recompute when the user edits their settings.
   */
  private preferenceChangeListeners: Array<() => void> = [];

  /**
   * Replace the preferences snapshot. Called once at extension boot by
   * ExtensionBridge, and again when the user edits preferences in the
   * launcher's Extensions settings tab. The snapshot is frozen at all
   * nesting levels — extensions cannot mutate it.
   *
   * After the snapshot is installed, registered `onPreferencesChanged`
   * listeners fire. They must re-read `context.preferences.values` to
   * pick up the new values.
   */
  public setPreferences(bundle: {
    extension: Record<string, unknown>;
    commands: Record<string, Record<string, unknown>>;
  }): void {
    this.preferences._setValues(buildFrozenSnapshot(bundle));

    // Fire listeners after the new snapshot is in place so they see the
    // fresh values on first read. Errors in one listener don't prevent
    // the others from running.
    for (const cb of this.preferenceChangeListeners) {
      try {
        cb();
      } catch (err) {
        console.error('[ExtensionContext] onPreferencesChanged listener threw:', err);
      }
    }
  }

  /**
   * Subscribe to preference change notifications. Returns an unsubscribe
   * function. The callback fires *after* `context.preferences` has been
   * replaced with a new frozen snapshot — re-read values inside the
   * callback, do not capture them from the enclosing scope.
   *
   * Typical use: an extension that caches a preference value at
   * `initialize()` time (e.g. to feed a timer engine's internal state)
   * uses this to recompute when the user edits the setting.
   */
  public onPreferencesChanged(callback: () => void): () => void {
    this.preferenceChangeListeners.push(callback);
    return () => {
      this.preferenceChangeListeners = this.preferenceChangeListeners.filter(
        (l) => l !== callback
      );
    };
  }

  // The local registry is now strictly for proxies. Keys are canonical
  // Namespace values — the same identifiers used on the wire — so a typo or
  // class-name-shaped key fails to compile.
  public readonly proxies: Partial<Record<Namespace, BaseServiceProxy>> = {
    log: new LogServiceProxy(),
    notifications: new NotificationServiceProxy(),
    clipboard: new ClipboardHistoryServiceProxy(),
    extensions: new ExtensionManagerProxy(),
    commands: new CommandServiceProxy(),
    actions: new ActionServiceProxy(),
    network: new NetworkServiceProxy(),
    settings: new SettingsServiceProxy(),
    statusBar: new StatusBarServiceProxy(),
    entitlements: new EntitlementServiceProxy(),
    storage: new StorageServiceProxy(),
    feedback: new FeedbackServiceProxy(),
    selection: new SelectionServiceProxy(),
    ai: new AIServiceProxy(),
    oauth: new OAuthServiceProxy(),
    shell: new ShellServiceProxy(),
    fs: new FileManagerServiceProxy(),
    interop: new InteropServiceProxy(),
    cache: new CacheServiceProxy(),
    application: new ApplicationServiceProxy(),
    window: new WindowManagementServiceProxy(),
    power: new PowerServiceProxy(),
    systemEvents: new SystemEventsServiceProxy(),
  };

  constructor() {
    setupFocusTracking();
    setupThemeInjection();
  }

  // Look up a proxy by its canonical namespace.
  getService<T>(namespace: Namespace): T {
    const service = this.proxies[namespace];
    if (!service) {
      throw new Error(`Service "${namespace}" not registered`);
    }
    return service as T;
  }

  setExtensionId(id: string): void {
    this.extensionId = id;
    // Inject into proxies if they support it
    for (const key of Object.keys(this.proxies)) {
      const svc = this.proxies[key as Namespace];
      if (svc && typeof svc.setExtensionId === 'function') {
        svc.setExtensionId(id);
      }
    }
    // The preferences facade composes its own proxy privately since it's
    // no longer in the proxies bag; push the id into it explicitly.
    this.preferences._setExtensionId(id);
    // The ExtensionBridge singleton has its own internal LogServiceProxy that
    // is constructed before any extension context exists, so it never goes
    // through the proxies-bag patching above. Push the extensionId to it now
    // so its `Registered action: ...` and similar debug logs don't get
    // rejected by the host IPC router for missing extensionId.
    //
    // We also self-register this context as the active context for this
    // extension id. Tier 2 iframes that bootstrap by creating their own
    // `ExtensionContext` (rather than going through
    // `bridge.initializeExtensions()`) otherwise never appear in the
    // bridge's `activeContexts` map, and `asyar:event:preferences:set-all`
    // can't find the live context to call `setPreferences` on.
    try {
      const bridge = ExtensionBridge.getInstance();
      bridge.setExtensionId(id);
      bridge.registerActiveContext(id, this);
    } catch {
      // ExtensionBridge import is at the bottom of this file (circular avoidance);
      // if for some reason it's not yet available, silently skip — the failure
      // mode is just the pre-existing log spam, not a hard error.
    }
  }

  registerAction(action: ExtensionAction): void {
    if (!this.extensionId) {
      console.error("Cannot register action: Extension ID not set");
      return;
    }
    const actionService = this.getService<ActionServiceProxy>('actions');
    actionService.registerAction(action);
  }

  unregisterAction(actionId: string): void {
    const actionService = this.getService<ActionServiceProxy>('actions');
    actionService.unregisterAction(actionId);
  }

  registerCommand(commandId: string, handler: CommandHandler): void {
    if (!this.extensionId) {
      console.error("Cannot register command: Extension ID not set");
      return;
    }
    const fullCommandId = `${this.extensionId}.${commandId}`;
    const commandService = this.getService<CommandServiceProxy>('commands');
    commandService.registerCommand(fullCommandId, handler, this.extensionId);
  }

  unregisterCommand(commandId: string): void {
    const fullCommandId = `${this.extensionId}.${commandId}`;
    const commandService = this.getService<CommandServiceProxy>('commands');
    commandService.unregisterCommand(fullCommandId);
  }

  /**
   * Build an `asyar://extensions/{extensionId}/{commandId}?args` deep link URL
   * for a command owned by this extension. Pure string formatting — no IPC.
   *
   * Extensions can embed the returned URL in notifications, clipboard output,
   * generated documents, or pass it to other apps.
   */
  createDeeplink(commandId: string, args?: Record<string, string>): string {
    if (!this.extensionId) {
      throw new Error('Cannot create deeplink: Extension ID not set');
    }
    let url = `asyar://extensions/${encodeURIComponent(this.extensionId)}/${encodeURIComponent(commandId)}`;
    if (args && Object.keys(args).length > 0) {
      const params = new URLSearchParams(args).toString();
      url += `?${params}`;
    }
    return url;
  }

  registerSyncProvider(provider: ExtensionSyncProvider): void {
    if (!this.extensionId) {
      console.error("Cannot register sync provider: Extension ID not set");
      return;
    }
    setupSyncProvider(this.extensionId, provider);
  }
}

// Import at the end to avoid circular dependencies
import { ExtensionBridge } from "./ExtensionBridge";
