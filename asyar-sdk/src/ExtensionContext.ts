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
import { TimerServiceProxy } from './services/TimerServiceProxy';
import { FileSystemWatcherServiceProxy } from './services/FileSystemWatcherService';
import { ExtensionStateProxy } from './services/ExtensionStateProxy';
import { extensionRpc } from './services/ExtensionRpc';

import { PreferencesFacade, type PreferencesSnapshot } from './PreferencesFacade';
export { PreferencesFacade, type PreferencesSnapshot } from './PreferencesFacade';
import { setupFocusTracking } from './lib/focusTracker';
import { setupThemeInjection } from './lib/themeInjector';
export { injectThemeVariables, injectFontFaceCSS } from './lib/themeInjector';

import { ExtensionContextCore } from './ExtensionContextCore';
export { ExtensionContextCore } from './ExtensionContextCore';
export type { ExtensionContextRole } from './ExtensionContextCore';

function buildFullProxyBag(): Partial<Record<Namespace, BaseServiceProxy>> {
  return {
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
    timers: new TimerServiceProxy(),
    fsWatcher: new FileSystemWatcherServiceProxy(),
    state: new ExtensionStateProxy(),
  };
}

/**
 * Full-surface ExtensionContext. Backs:
 *   - Tier 1 launcher built-in features (type-only reference).
 *   - `asyar-sdk/view` entry point (UI-capable extensions).
 *
 * For worker-context extensions, see `asyar-sdk/worker` — it exports a
 * narrower ExtensionContext without DOM-dependent proxies.
 */
export class ExtensionContext extends ExtensionContextCore {
  constructor() {
    super({ role: 'view', proxies: buildFullProxyBag() });
    setupFocusTracking();
    setupThemeInjection();

    // View-side RPC plumbing: install the reply-push listener once per
    // ExtensionContext construction, and wire a `pagehide` handler that
    // drops every pending reply so the next mount sees no zombie state.
    // The view-side ExtensionStateProxy's pagehide auto-unsubscribe is
    // installed alongside so every active subscription is torn down in
    // the same cleanup pass.
    extensionRpc.installViewMessageListener();
    extensionRpc.installViewAutoCleanup();
    const stateProxy = this.proxies.state as ExtensionStateProxy | undefined;
    stateProxy?.installViewAutoUnsubscribe();
  }

  /**
   * View-side RPC entry. Sends a request into this extension's worker and
   * awaits the worker handler's reply. Default 5s timeout, overridable via
   * `opts.timeoutMs`. See `ExtensionRpc.request` for the AbortSignal +
   * stale-reply contract.
   */
  request<TResult = unknown>(
    id: string,
    payload?: unknown,
    opts?: { timeoutMs?: number },
  ): Promise<TResult> {
    return extensionRpc.request(id, payload, opts) as Promise<TResult>;
  }

  protected override notifyBridgeIfAvailable(id: string): void {
    try {
      extensionBridge.setExtensionId(id);
      extensionBridge.registerActiveContext(id, this as any);
    } catch {
      // bridge module not yet available (circular import startup); skip.
    }
  }
}

export type { PreferencesSnapshot as _Unused } from './PreferencesFacade';

// Import at the end to avoid circular dependencies
import { extensionBridge } from "./ExtensionBridge";
