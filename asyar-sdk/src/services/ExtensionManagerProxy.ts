import type { IExtensionManager } from "./IExtensionManager";
import type { ExtensionResult } from "../types/ExtensionType";
import { BaseServiceProxy } from "./BaseServiceProxy";

export class ExtensionManagerProxy extends BaseServiceProxy implements IExtensionManager {
  private _currentExtension: any = null;
  public isReady: any = null; // Satisfy interface

  get currentExtension(): any {
    return this._currentExtension;
  }

  set currentExtension(value: any) {
    this._currentExtension = value;
  }

  init(): Promise<boolean> {
    return this.broker.invoke<boolean>('extensions:init');
  }

  loadExtensions(): Promise<void> {
    return this.broker.invoke<void>('extensions:loadExtensions');
  }

  reloadExtensions(): Promise<void> {
    return this.broker.invoke<void>('extensions:reloadExtensions');
  }

  isExtensionEnabled(extensionName: string): boolean {
    console.warn('isExtensionEnabled called synchronously in proxy. Returning true as fallback.');
    return true;
  }

  toggleExtensionState(extensionName: string, enabled: boolean): Promise<boolean> {
    return this.broker.invoke<boolean>('extensions:toggleExtensionState', { extensionName, enabled });
  }

  getAllExtensionsWithState(): Promise<any[]> {
    return this.broker.invoke<any[]>('extensions:getAllExtensionsWithState');
  }

  searchAll(query: string): Promise<ExtensionResult[]> {
    return this.broker.invoke<ExtensionResult[]>('extensions:searchAll', { query });
  }

  handleViewSearch(query: string): Promise<void> {
    return this.broker.invoke<void>('extensions:handleViewSearch', { query });
  }

  handleViewSubmit(query: string): Promise<void> {
    return this.broker.invoke<void>('extensions:handleViewSubmit', { query });
  }

  navigateToView(viewPath: string): void {
    this.broker.invoke('extensions:navigateToView', { viewPath }).catch(console.error);
  }

  goBack(): void {
    this.broker.invoke('extensions:goBack').catch(console.error);
  }

  forwardKeyToActiveView(keyEvent: any): void {
    this.broker.invoke('extensions:forwardKeyToActiveView', { keyEvent }).catch(console.error);
  }

  getAllExtensions(): Promise<any[]> {
    return this.broker.invoke<any[]>('extensions:getAllExtensions');
  }

  uninstallExtension(extensionId: string, extensionName: string): Promise<boolean> {
    return this.broker.invoke<boolean>('extensions:uninstallExtension', { extensionId, extensionName });
  }

  setActiveViewActionLabel(label: string | null): void {
    this.broker.invoke('extensions:setActiveViewActionLabel', { label }).catch(console.error);
  }

  setActiveViewSubtitle(subtitle: string | null): void {
    this.broker.invoke('extensions:setActiveViewSubtitle', { subtitle }).catch(console.error);
  }
}

