import type { IExtensionManager } from "./IExtensionManager";
import type { ExtensionManifest, ExtensionResult, ExtensionWithState } from "../types/ExtensionType";
import { BaseServiceProxy } from "./BaseServiceProxy";

export class ExtensionManagerProxy extends BaseServiceProxy implements IExtensionManager {
  private _currentExtension: ExtensionManifest | null = null;
  public isReady: boolean = false;

  get currentExtension(): ExtensionManifest | null {
    return this._currentExtension;
  }

  set currentExtension(value: ExtensionManifest | null) {
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

  getAllExtensionsWithState(): Promise<ExtensionWithState[]> {
    return this.broker.invoke<ExtensionWithState[]>('extensions:getAllExtensionsWithState');
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
    this.broker.invoke('extensions:navigateToView', { viewPath }).catch(err => console.warn('[ExtensionManagerProxy] navigateToView failed:', err));
  }

  goBack(): void {
    this.broker.invoke('extensions:goBack').catch(err => console.warn('[ExtensionManagerProxy] goBack failed:', err));
  }

  forwardKeyToActiveView(keyEvent: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }): void {
    this.broker.invoke('extensions:forwardKeyToActiveView', { keyEvent }).catch(err => console.warn('[ExtensionManagerProxy] forwardKeyToActiveView failed:', err));
  }

  getAllExtensions(): Promise<ExtensionManifest[]> {
    return this.broker.invoke<ExtensionManifest[]>('extensions:getAllExtensions');
  }

  uninstallExtension(extensionId: string, extensionName: string): Promise<boolean> {
    return this.broker.invoke<boolean>('extensions:uninstallExtension', { extensionId, extensionName });
  }

  setActiveViewActionLabel(label: string | null): void {
    this.broker.invoke('extensions:setActiveViewActionLabel', { label }).catch(err => console.warn('[ExtensionManagerProxy] setActiveViewActionLabel failed:', err));
  }

  setActiveViewSubtitle(subtitle: string | null): void {
    this.broker.invoke('extensions:setActiveViewSubtitle', { subtitle }).catch(err => console.warn('[ExtensionManagerProxy] setActiveViewSubtitle failed:', err));
  }
}

