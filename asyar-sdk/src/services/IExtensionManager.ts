import { ExtensionResult } from "../types/ExtensionType";

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
  goBack(): void; // Renamed from closeView
  getAllExtensions(): Promise<any[]>;
  uninstallExtension(
    extensionId: string,
    extensionName: string
  ): Promise<boolean>;
  currentExtension: any;
  /**
   * Allows an active view extension to suggest a primary action label
   * to be displayed in the UI (e.g., in the bottom action bar).
   * @param label The suggested label (e.g., "Paste", "Save"), or null to clear.
   */
  setActiveViewActionLabel(label: string | null): void;
}
