import type { ExtensionSyncProvider } from "./types/SyncType";
import type { ExtensionAction } from "./types/ActionType";
import type { CommandHandler } from "./types/CommandType";
import type { Namespace } from "./ipc/namespaces";
import type { BaseServiceProxy } from "./services/BaseServiceProxy";

import { PreferencesFacade, buildFrozenSnapshot } from './PreferencesFacade';
import { registerSyncProvider as setupSyncProvider } from './lib/syncProviderBridge';

export type ExtensionContextRole = 'worker' | 'view';

interface CoreInit {
  role: ExtensionContextRole;
  proxies: Partial<Record<Namespace, BaseServiceProxy>>;
}

/**
 * Shared plumbing for both worker- and view-scoped ExtensionContexts.
 *
 * Consumers never construct this class directly — the role-specific entry
 * points (`asyar-sdk/worker` / `asyar-sdk/view`) build a subclass with the
 * correct proxies bag, and launcher Tier 1 code references the class only
 * as a type.
 */
export class ExtensionContextCore {
  private extensionId: string = "";
  public readonly role: ExtensionContextRole;
  public readonly preferences: PreferencesFacade = new PreferencesFacade();
  public readonly proxies: Partial<Record<Namespace, BaseServiceProxy>>;

  private preferenceChangeListeners: Array<() => void> = [];

  constructor(init: CoreInit) {
    this.role = init.role;
    this.proxies = init.proxies;
  }

  public setPreferences(bundle: {
    extension: Record<string, unknown>;
    commands: Record<string, Record<string, unknown>>;
  }): void {
    this.preferences._setValues(buildFrozenSnapshot(bundle));
    for (const cb of this.preferenceChangeListeners) {
      try {
        cb();
      } catch (err) {
        console.error('[ExtensionContext] onPreferencesChanged listener threw:', err);
      }
    }
  }

  public onPreferencesChanged(callback: () => void): () => void {
    this.preferenceChangeListeners.push(callback);
    return () => {
      this.preferenceChangeListeners = this.preferenceChangeListeners.filter(
        (l) => l !== callback
      );
    };
  }

  getService<T>(namespace: Namespace): T {
    const service = this.proxies[namespace];
    if (!service) {
      throw new Error(`Service "${namespace}" not registered`);
    }
    return service as T;
  }

  setExtensionId(id: string): void {
    this.extensionId = id;
    for (const key of Object.keys(this.proxies)) {
      const svc = this.proxies[key as Namespace];
      if (svc && typeof svc.setExtensionId === 'function') {
        svc.setExtensionId(id);
      }
    }
    this.preferences._setExtensionId(id);

    this.notifyBridgeIfAvailable(id);
    this.emitLoadedEvent(id);
  }

  protected notifyBridgeIfAvailable(_id: string): void {
    // Subclasses that pull in ExtensionBridge override this. The core class
    // has no static import of the bridge so Tier 1 / worker consumers can
    // opt out of the keystroke-forwarder side effects.
  }

  protected emitLoadedEvent(id: string): void {
    try {
      if (
        typeof window !== 'undefined' &&
        window.parent &&
        window.parent !== window &&
        typeof window.parent.postMessage === 'function'
      ) {
        const role = this.resolveRuntimeRole();
        window.parent.postMessage(
          { type: 'asyar:extension:loaded', extensionId: id, role },
          '*',
        );
      }
    } catch {
      // best-effort — host will time out and strike if we can't signal.
    }
  }

  private resolveRuntimeRole(): ExtensionContextRole {
    if (typeof window !== 'undefined') {
      const injected = (window as any).__ASYAR_ROLE__;
      if (injected === 'worker' || injected === 'view') return injected;
    }
    return this.role;
  }

  registerAction(action: ExtensionAction): void {
    if (!this.extensionId) {
      console.error("Cannot register action: Extension ID not set");
      return;
    }
    const actions = this.proxies.actions as unknown as {
      registerAction: (a: ExtensionAction) => void;
    } | undefined;
    if (!actions) {
      throw new Error('actions service not available in this context');
    }
    actions.registerAction(action);
  }

  unregisterAction(actionId: string): void {
    const actions = this.proxies.actions as unknown as {
      unregisterAction: (id: string) => void;
    } | undefined;
    if (!actions) return;
    actions.unregisterAction(actionId);
  }

  registerCommand(commandId: string, handler: CommandHandler): void {
    if (!this.extensionId) {
      console.error("Cannot register command: Extension ID not set");
      return;
    }
    const fullCommandId = `${this.extensionId}.${commandId}`;
    const commands = this.proxies.commands as unknown as {
      registerCommand: (id: string, h: CommandHandler, extId: string) => void;
    } | undefined;
    if (!commands) {
      throw new Error('commands service not available in this context');
    }
    commands.registerCommand(fullCommandId, handler, this.extensionId);
  }

  unregisterCommand(commandId: string): void {
    const fullCommandId = `${this.extensionId}.${commandId}`;
    const commands = this.proxies.commands as unknown as {
      unregisterCommand: (id: string) => void;
    } | undefined;
    if (!commands) return;
    commands.unregisterCommand(fullCommandId);
  }

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
