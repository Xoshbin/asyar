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
