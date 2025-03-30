import type { AppSettings } from "../types/AppSettingsType";

/**
 * Interface for Settings Service
 */
export interface ISettingsService {
  init(): Promise<boolean>;
  isInitialized(): boolean;
  load(): Promise<void>;
  save(): Promise<boolean>;
  getSettings(): AppSettings;
  updateSettings<K extends keyof AppSettings>(
    section: K,
    values: Partial<AppSettings[K]>
  ): Promise<boolean>;
  subscribe(callback: (settings: AppSettings) => void): () => void;
  updateExtensionState(
    extensionName: string,
    enabled: boolean
  ): Promise<boolean>;
  removeExtensionState(extensionName: string): Promise<boolean>;
  isExtensionEnabled(extensionName: string): boolean;
  getExtensionStates(): Record<string, boolean>;
}
