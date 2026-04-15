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
  PreferencesServiceProxy,
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

/**
 * A frozen snapshot of an extension's effective preferences, taken at
 * extension boot. Extension-level preferences are flat keys on this object;
 * command-level preferences live under `commands[commandId]`.
 *
 * This snapshot is NOT live. When the user edits preferences in Settings,
 * the launcher reloads the extension and a fresh context is created.
 * Extensions should not cache `context.preferences` across reloads.
 */
export interface PreferencesSnapshot {
  [key: string]: unknown;
  commands: { [commandId: string]: { [key: string]: unknown } };
}

// Define the context that will be passed to extensions
export class ExtensionContext {
  private extensionId: string = "";
  public preferences: PreferencesSnapshot = Object.freeze({
    commands: Object.freeze({}),
  }) as PreferencesSnapshot;

  /**
   * Listeners notified *after* `setPreferences` installs a new frozen
   * snapshot. Callbacks take no arguments and must re-read fresh values
   * from `context.preferences` — the snapshot is already in place when
   * they fire. This is a read-only notification, not a live getter:
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
   * listeners fire. They must re-read `context.preferences` to pick up
   * the new values.
   */
  public setPreferences(bundle: {
    extension: Record<string, unknown>;
    commands: Record<string, Record<string, unknown>>;
  }): void {
    const snapshot: any = { ...bundle.extension, commands: {} };
    for (const [cmdId, prefs] of Object.entries(bundle.commands ?? {})) {
      snapshot.commands[cmdId] = Object.freeze({ ...prefs });
    }
    Object.freeze(snapshot.commands);
    this.preferences = Object.freeze(snapshot) as PreferencesSnapshot;

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
    preferences: new PreferencesServiceProxy(),
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
  };

  constructor() {
    this.setupFocusTracking();
    this.setupThemeInjection();
  }

  private setupFocusTracking() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    
    const isInput = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'select') return true;
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
        const textTypes = ['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'date', 'time', 'datetime-local', 'month', 'week'];
        return textTypes.includes(type);
      }
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    };

    let currentlyFocused = false;
    const emitFocus = (focused: boolean) => {
      // Only emit if we are in an iframe (sandboxed extension)
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'asyar:extension:input-focus', focused }, '*');
      }
    };

    // Use focusin and focusout because they bubble and capture generic focus changes
    document.addEventListener('focusin', (e) => {
      const active = isInput(e.target as Element);
      if (active !== currentlyFocused) {
        currentlyFocused = active;
        emitFocus(currentlyFocused);
      }
    });

    document.addEventListener('focusout', () => {
      // Small timeout to allow the next element to receive focus
      setTimeout(() => {
        const active = isInput(document.activeElement);
        if (active !== currentlyFocused) {
          currentlyFocused = active;
          emitFocus(currentlyFocused);
        }
      }, 0);
    });
  }

  private setupThemeInjection() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'asyar:theme:variables') {
        const vars = event.data.payload as Record<string, string>;
        if (!vars || typeof vars !== 'object') return;
        injectThemeVariables(vars);
        return;
      }
      if (event.data?.type === 'asyar:theme:fonts') {
        const css = event.data.payload as string;
        if (!css || typeof css !== 'string') return;
        injectFontFaceCSS(css);
        return;
      }
    });
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
      const svc = (this.proxies as any)[key];
      if (svc && typeof svc.setExtensionId === 'function') {
        svc.setExtensionId(id);
      }
    }
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
    const bridge = ExtensionBridge.getInstance();
    if (this.extensionId) {
      bridge.registerAction(this.extensionId, action);

      // We also need to notify the ActionServiceProxy to send the IPC message
      const actionService = this.getService<ActionServiceProxy>('actions');
      actionService.registerAction(action);
    } else {
      console.error("Cannot register action: Extension ID not set");
    }
  }

  unregisterAction(actionId: string): void {
    // Use bare actionId — matches the format used in registerAction (no extension prefix)
    const bridge = ExtensionBridge.getInstance();
    bridge.unregisterAction(actionId);

    const actionService = this.getService<ActionServiceProxy>('actions');
    actionService.unregisterAction(actionId);
  }

  registerCommand(commandId: string, handler: CommandHandler): void {
    const bridge = ExtensionBridge.getInstance();
    if (this.extensionId) {
      const fullCommandId = `${this.extensionId}.${commandId}`;
      bridge.registerCommand(
        fullCommandId,
        handler,
        this.extensionId
      );

      const commandService = this.getService<CommandServiceProxy>('commands');
      commandService.registerCommand(fullCommandId, handler, this.extensionId);
    } else {
      console.error("Cannot register command: Extension ID not set");
    }
  }

  unregisterCommand(commandId: string): void {
    const fullCommandId = `${this.extensionId}.${commandId}`;
    const bridge = ExtensionBridge.getInstance();
    bridge.unregisterCommand(fullCommandId);

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

    // Send registration to host via postMessage
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'asyar:sync:register',
        extensionId: this.extensionId,
        payload: {
          displayName: provider.displayName,
          sensitiveFields: provider.sensitiveFields || [],
          defaultEnabled: provider.defaultEnabled ?? true,
        },
      }, '*');
    }

    // Store the provider locally so the host can call back into it
    (this as any)._syncProvider = provider;

    // Listen for sync IPC calls from host
    if (typeof window !== 'undefined') {
      window.addEventListener('message', async (event: MessageEvent) => {
        if (event.data?.type === 'asyar:sync:export' && event.data?.extensionId === this.extensionId) {
          try {
            const data = await provider.export();
            window.parent.postMessage({
              type: 'asyar:sync:export:response',
              extensionId: this.extensionId,
              messageId: event.data.messageId,
              payload: data,
              success: true,
            }, '*');
          } catch (err) {
            window.parent.postMessage({
              type: 'asyar:sync:export:response',
              extensionId: this.extensionId,
              messageId: event.data.messageId,
              success: false,
              error: String(err),
            }, '*');
          }
        }

        if (event.data?.type === 'asyar:sync:import' && event.data?.extensionId === this.extensionId) {
          try {
            await provider.import(event.data.payload.data, event.data.payload.strategy);
            window.parent.postMessage({
              type: 'asyar:sync:import:response',
              extensionId: this.extensionId,
              messageId: event.data.messageId,
              success: true,
            }, '*');
          } catch (err) {
            window.parent.postMessage({
              type: 'asyar:sync:import:response',
              extensionId: this.extensionId,
              messageId: event.data.messageId,
              success: false,
              error: String(err),
            }, '*');
          }
        }

        if (event.data?.type === 'asyar:sync:preview' && event.data?.extensionId === this.extensionId) {
          try {
            const result = await provider.preview(event.data.payload.data);
            window.parent.postMessage({
              type: 'asyar:sync:preview:response',
              extensionId: this.extensionId,
              messageId: event.data.messageId,
              payload: result,
              success: true,
            }, '*');
          } catch (err) {
            window.parent.postMessage({
              type: 'asyar:sync:preview:response',
              extensionId: this.extensionId,
              messageId: event.data.messageId,
              success: false,
              error: String(err),
            }, '*');
          }
        }
      });
    }
  }
}

// Helper function to inject theme variables into the document
export function injectThemeVariables(vars: Record<string, string>): void {
  let style = document.getElementById('asyar-theme-vars') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'asyar-theme-vars';
    document.head.appendChild(style);
  }
  const declarations = Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  style.textContent = `:root {\n${declarations}\n}`;
}

// Helper function to inject font face CSS into the document
export function injectFontFaceCSS(css: string): void {
  let style = document.getElementById('asyar-theme-fonts') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'asyar-theme-fonts';
    document.head.appendChild(style);
  }
  style.textContent = css;
}

// Import at the end to avoid circular dependencies
import { ExtensionBridge } from "./ExtensionBridge";
