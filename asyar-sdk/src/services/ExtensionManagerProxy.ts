import type { IExtensionManager } from "./IExtensionManager";
import type { ExtensionResult } from "../types/ExtensionType";
import { BaseServiceProxy } from "./BaseServiceProxy";

export class ExtensionManagerProxy extends BaseServiceProxy implements IExtensionManager {
  private _currentExtension: any = null;

  get currentExtension(): any {
    return this._currentExtension;
  }

  set currentExtension(value: any) {
    this._currentExtension = value;
  }

  init(): Promise<boolean> {
    return this.broker.invoke<boolean>('extension:init');
  }

  loadExtensions(): Promise<void> {
    return this.broker.invoke<void>('extension:loadExtensions');
  }

  reloadExtensions(): Promise<void> {
    return this.broker.invoke<void>('extension:reloadExtensions');
  }

  isExtensionEnabled(extensionName: string): boolean {
    console.warn('isExtensionEnabled called synchronously in proxy. Returning true as fallback.');
    return true;
  }

  toggleExtensionState(extensionName: string, enabled: boolean): Promise<boolean> {
    return this.broker.invoke<boolean>('extension:toggleExtensionState', { extensionName, enabled });
  }

  getAllExtensionsWithState(): Promise<any[]> {
    return this.broker.invoke<any[]>('extension:getAllExtensionsWithState');
  }

  searchAll(query: string): Promise<ExtensionResult[]> {
    return this.broker.invoke<ExtensionResult[]>('extension:searchAll', { query });
  }

  handleViewSearch(query: string): Promise<void> {
    return this.broker.invoke<void>('extension:handleViewSearch', { query });
  }

  navigateToView(viewPath: string): void {
    this.broker.invoke('extension:navigateToView', { viewPath }).catch(console.error);
  }

  goBack(): void {
    this.broker.invoke('extension:goBack').catch(console.error);
  }

  getAllExtensions(): Promise<any[]> {
    return this.broker.invoke<any[]>('extension:getAllExtensions');
  }

  uninstallExtension(extensionId: string, extensionName: string): Promise<boolean> {
    return this.broker.invoke<boolean>('extension:uninstallExtension', { extensionId, extensionName });
  }

  setActiveViewActionLabel(label: string | null): void {
    this.broker.invoke('extension:setActiveViewActionLabel', { label }).catch(console.error);
  }

  setActiveViewStatusMessage(message: string | null): void {
    this.broker.invoke('extension:setActiveViewStatusMessage', { message }).catch(console.error);
  }
}

