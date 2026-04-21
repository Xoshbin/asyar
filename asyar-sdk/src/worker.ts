/**
 * asyar-sdk/worker — headless entry for worker-context extension code.
 *
 * Asserts `window.__ASYAR_ROLE__ === "worker"` at module load, before any
 * proxy is instantiated. Mis-imports fail fast with a clear message.
 *
 * Does NOT re-export the full SDK surface. Feedback, selection, interop,
 * clipboard-history, icons, and other DOM-dependent helpers are kept out
 * of the worker's import graph so the worker bundle stays small and is
 * mechanically incapable of touching the document.
 */

if (
  typeof window === 'undefined' ||
  (window as { __ASYAR_ROLE__?: unknown }).__ASYAR_ROLE__ !== 'worker'
) {
  throw new Error(
    '[asyar-sdk/worker] Imported outside a worker context. ' +
    'This entry point is intended for code running in worker.html ' +
    '(a Tier 2 extension\'s headless iframe). ' +
    'Did you mean to import from "asyar-sdk/view"?',
  );
}

import type { Namespace } from './ipc/namespaces';
import type { BaseServiceProxy } from './services/BaseServiceProxy';

import { LogServiceProxy } from './services/LogServiceProxy';
import { NotificationServiceProxy } from './services/NotificationServiceProxy';
import { StorageServiceProxy } from './services/StorageServiceProxy';
import { CacheServiceProxy } from './services/CacheServiceProxy';
import { NetworkServiceProxy } from './services/NetworkServiceProxy';
import { ShellServiceProxy } from './services/ShellServiceProxy';
import { AIServiceProxy } from './services/AIServiceProxy';
import { OAuthServiceProxy } from './services/OAuthServiceProxy';
import { FileManagerServiceProxy } from './services/FileManagerServiceProxy';
import { ApplicationServiceProxy } from './services/ApplicationService';
import { PowerServiceProxy } from './services/PowerServiceProxy';
import { SystemEventsServiceProxy } from './services/SystemEventsServiceProxy';
import { TimerServiceProxy } from './services/TimerServiceProxy';
import { StatusBarServiceProxy } from './services/StatusBarServiceProxy';

import { ExtensionContextCore } from './ExtensionContextCore';

function buildWorkerProxyBag(): Partial<Record<Namespace, BaseServiceProxy>> {
  return {
    log: new LogServiceProxy(),
    notifications: new NotificationServiceProxy(),
    storage: new StorageServiceProxy(),
    cache: new CacheServiceProxy(),
    network: new NetworkServiceProxy(),
    shell: new ShellServiceProxy(),
    ai: new AIServiceProxy(),
    oauth: new OAuthServiceProxy(),
    fs: new FileManagerServiceProxy(),
    application: new ApplicationServiceProxy(),
    power: new PowerServiceProxy(),
    systemEvents: new SystemEventsServiceProxy(),
    timers: new TimerServiceProxy(),
    statusBar: new StatusBarServiceProxy(),
  };
}

export class ExtensionContext extends ExtensionContextCore {
  constructor() {
    super({ role: 'worker', proxies: buildWorkerProxyBag() });
  }
}

export { messageBroker, MessageBroker } from './ipc/MessageBroker';
export type { IPCMessage, IPCResponse, HostDispatcher } from './ipc/MessageBroker';
export { NAMESPACES, isNamespace } from './ipc/namespaces';
export type { Namespace, WireCommand } from './ipc/namespaces';
export { extensionBridge, ExtensionBridge } from './ExtensionBridge';
export { PreferencesFacade } from './PreferencesFacade';
export type { PreferencesSnapshot } from './PreferencesFacade';
