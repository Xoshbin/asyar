import type { IStatusBarService, IStatusBarItem } from './IStatusBarService';
import { BaseServiceProxy } from './BaseServiceProxy';

export class StatusBarServiceProxy extends BaseServiceProxy implements IStatusBarService {
  registerItem(item: IStatusBarItem): void {
    const fullItem = { ...item, extensionId: this.extensionId };
    this.broker.invoke('statusBar:registerItem', { item: fullItem }).catch(err => console.warn('[StatusBarServiceProxy] registerItem failed:', err));
  }

  updateItem(id: string, updates: Partial<Pick<IStatusBarItem, 'icon' | 'text'>>): void {
    this.broker.invoke('statusBar:updateItem', { extensionId: this.extensionId, id, updates }).catch(err => console.warn('[StatusBarServiceProxy] updateItem failed:', err));
  }

  unregisterItem(id: string): void {
    this.broker.invoke('statusBar:unregisterItem', { extensionId: this.extensionId, id }).catch(err => console.warn('[StatusBarServiceProxy] unregisterItem failed:', err));
  }
}

