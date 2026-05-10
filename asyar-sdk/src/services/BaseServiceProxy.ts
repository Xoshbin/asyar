import { MessageBroker, messageBroker } from '../ipc/MessageBroker';
import type { WireCommand } from '../ipc/namespaces';

/**
 * Abstract base class shared by all SDK service proxy implementations.
 *
 * Provides the singleton broker reference and the `setExtensionId` method
 * that patches the broker's `invoke` to automatically forward the extension
 * ID on every IPC call — eliminating repeated boilerplate in each proxy.
 */
export abstract class BaseServiceProxy {
  protected broker: MessageBroker;
  protected extensionId: string = '';

  constructor() {
    this.broker = messageBroker;
  }

  setExtensionId(id: string): void {
    this.extensionId = id;
    const originalInvoke = this.broker.invoke.bind(this.broker);
    // Patch only `invoke` on a prototype-chained clone so other methods
    // (`on`, `off`, `setHostDispatcher`, etc.) fall through to the singleton
    // and read its shared `eventListeners` / `pendingRequests` Maps. This is
    // why proxy handles capturing `this.broker` after setExtensionId still
    // see launcher-emitted events: `broker.on(...)` mutates the singleton's
    // listener Map via the prototype chain, and the singleton's
    // `handleMessage` dispatches to that same Map. Adding overrides on the
    // patched broker for any other method would silently break this.
    this.broker = Object.create(this.broker) as MessageBroker;
    // Forward all four args so per-call overrides (e.g. a longer
    // `timeoutMs` for blocking confirm dialogs) survive the patch.
    this.broker.invoke = <T>(
      command: WireCommand,
      payload?: Record<string, unknown> | unknown[],
      _eid?: string,
      timeoutMs?: number,
    ) => originalInvoke<T>(command, payload, id, timeoutMs);
  }
}
