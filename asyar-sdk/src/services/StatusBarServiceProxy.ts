import type { IStatusBarService, IStatusBarItem } from './IStatusBarService';
import { BaseServiceProxy } from './BaseServiceProxy';

export class StatusBarServiceProxy extends BaseServiceProxy implements IStatusBarService {
  registerItem(item: IStatusBarItem): void {
    const fullItem = { ...item, extensionId: this.extensionId };
    this.broker.invoke('statusBar:registerItem', { item: fullItem }).catch(console.error);
  }

  updateItem(id: string, updates: Partial<Pick<IStatusBarItem, 'icon' | 'text'>>): void {
    this.broker.invoke('statusBar:updateItem', { extensionId: this.extensionId, id, updates }).catch(console.error);
  }

  unregisterItem(id: string): void {
    this.broker.invoke('statusBar:unregisterItem', { extensionId: this.extensionId, id }).catch(console.error);
  }
}

