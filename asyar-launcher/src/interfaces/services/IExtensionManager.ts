import type { ExtensionResult } from "../../types";

/**
 * Interface for Extension Manager
 */
export interface IExtensionManager {
  init(): Promise<boolean>;
  loadExtensions(): Promise<void>;
  isExtensionEnabled(extensionName: string): boolean;
  toggleExtensionState(
    extensionName: string,
    enabled: boolean
  ): Promise<boolean>;
  getAllExtensionsWithState(): Promise<any[]>;
  searchAll(query: string): Promise<ExtensionResult[]>;
  handleViewSearch(query: string): Promise<void>;
  navigateToView(viewPath: string): void;
  closeView(): void;
  getAllExtensions(): Promise<any[]>;
  uninstallExtension(
    extensionId: string,
    extensionName: string
  ): Promise<boolean>;
  currentExtension: any;
}
