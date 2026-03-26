import { MessageBroker } from '../ipc/MessageBroker';

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
    this.broker.invoke = <T>(command: string, payload?: any) =>
      originalInvoke(command, payload, id);
  }
}
