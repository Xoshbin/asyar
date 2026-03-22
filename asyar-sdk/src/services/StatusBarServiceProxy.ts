import { MessageBroker } from '../ipc/MessageBroker';
import type { IStatusBarService, IStatusBarItem } from './IStatusBarService';

export class StatusBarServiceProxy implements IStatusBarService {
  private broker: MessageBroker;
  private extensionId: string = '';

  constructor() {
    this.broker = MessageBroker.getInstance();
  }

  setExtensionId(id: string): void {
    this.extensionId = id;
    const originalInvoke = this.broker.invoke.bind(this.broker);
    this.broker = Object.create(this.broker);
    this.broker.invoke = <T>(command: string, payload?: any) =>
      originalInvoke(command, payload, id);
  }

  registerItem(item: IStatusBarItem): void {
    const fullItem = { ...item, extensionId: this.extensionId };
    this.broker.invoke('statusbar:registerItem', { item: fullItem }).catch(console.error);
  }

  updateItem(
    id: string,
    updates: Partial<Pick<IStatusBarItem, 'icon' | 'text'>>
  ): void {
    this.broker.invoke('statusbar:updateItem', { extensionId: this.extensionId, id, updates }).catch(console.error);
  }

  unregisterItem(id: string): void {
    this.broker.invoke('statusbar:unregisterItem', { extensionId: this.extensionId, id }).catch(console.error);
  }
}
