import { IExtensionManager } from "./IExtensionManager";
import { MessageBroker } from "../ipc/MessageBroker";
import { ExtensionResult } from "../types/ExtensionType";

export class ExtensionManagerProxy implements IExtensionManager {
  private broker: MessageBroker;
  private _currentExtension: any = null;
  private extensionId?: string;

  constructor() {
    this.broker = MessageBroker.getInstance();
    // In an iframe context, the current extension ID should ideally be
    // initialized via a message from the host, but we can set up a listener for it
    // if the main process sends the state.
  }

  setExtensionId(id: string) {
    this.extensionId = id;
    const originalInvoke = this.broker.invoke.bind(this.broker);
    this.broker = Object.create(this.broker);
    this.broker.invoke = <T>(command: string, payload?: any) => originalInvoke(command, payload, id);
  }

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

  // NOTE: isExtensionEnabled is a synchronous method in the interface
  // which might be tricky with IPC. Returning a dummy value for now,
  // though extensions shouldn't usually check this synchronously.
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
    // [ARCHITECTURE SAFEGUARD]: IPC PAYLOAD STRUCTURE
    // The Host Window (ExtensionManager.ts) dynamically unpacks IPC method payloads 
    // into positional arguments using `Object.values(payload)`. 
    // Therefore, EVERY proxy method here MUST send its payload as a named-key object 
    // where the keys correspond to the target method's parameter names in order.
    // Example: Sending `{ viewPath }` becomes `navigateToView(viewPath)`.
    // NEVER send raw primitives like `this.broker.invoke('...', viewPath)`, as it
    // will break the Host's generic argument deserializer.
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
}
