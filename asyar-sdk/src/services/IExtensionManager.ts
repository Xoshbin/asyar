import type { ExtensionManifest, ExtensionResult, ExtensionWithState } from "../types/ExtensionType";

/**
 * Interface for Extension Manager
 */
export interface IExtensionManager {
  init(): Promise<boolean>;
  loadExtensions(): Promise<void>;
  reloadExtensions(): Promise<void>;
  isExtensionEnabled(extensionName: string): boolean;
  toggleExtensionState(
    extensionName: string,
    enabled: boolean
  ): Promise<boolean>;
  getAllExtensionsWithState(): Promise<ExtensionWithState[]>;
  searchAll(query: string): Promise<ExtensionResult[]>;
  handleViewSearch(query: string): Promise<void>;
  handleViewSubmit(query: string): Promise<void>;
  navigateToView(viewPath: string): void;
  goBack(): void; // Renamed from closeView
  forwardKeyToActiveView(keyEvent: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }): void;
  isReady: boolean;
  getAllExtensions(): Promise<ExtensionManifest[]>;
  uninstallExtension(
    extensionId: string,
    extensionName: string
  ): Promise<boolean>;
  currentExtension: ExtensionManifest | null;
  /**
   * Allows an active view extension to suggest a primary action label
   * to be displayed in the UI (e.g., in the bottom action bar).
   * @param label The suggested label (e.g., "Paste", "Save"), or null to clear.
   */
  setActiveViewActionLabel(label: string | null): void;
  /**
   * Persistent secondary label shown next to the active view's title
   * (e.g. `"openai · gpt-4o"`).
   *
   * Unlike toasts, this label has no auto-dismiss and is intended for
   * view metadata that should remain visible while the view is active.
   * Pass `null` to clear.
   */
  setActiveViewSubtitle(subtitle: string | null): void;
}
