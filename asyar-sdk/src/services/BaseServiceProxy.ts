import { MessageBroker } from '../ipc/MessageBroker';
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
    this.broker = MessageBroker.getInstance();
  }

  setExtensionId(id: string): void {
    this.extensionId = id;
    const originalInvoke = this.broker.invoke.bind(this.broker);
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
