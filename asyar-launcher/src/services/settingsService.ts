import { writable, get } from "svelte/store";
import { Store, load } from "@tauri-apps/plugin-store";
import { logService } from "./logService";
import { appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types";
import type { ISettingsService } from "./interfaces/ISettingsService";

// Default settings
const DEFAULT_SETTINGS: AppSettings = {
  general: {
    startAtLogin: false,
    showDockIcon: true,
  },
  search: {
    searchApplications: true,
    searchSystemPreferences: true,
    fuzzySearch: true,
  },
  shortcut: {
    modifier: "Super",
    key: "K",
  },
  appearance: {
    theme: "system",
    windowWidth: 800,
    windowHeight: 600,
  },
  // Initialize with empty extensions state
  extensions: {
    enabled: {},
  },
};

// Create the store
const settingsStore = writable<AppSettings>(DEFAULT_SETTINGS);

// Settings service implementation
class SettingsService implements ISettingsService {
  private initialized = false;
  private store: Store | null = null;
  private storeFilePath = "settings.dat";

  constructor() {
    // Set default values in the store immediately
    settingsStore.set(DEFAULT_SETTINGS);
  }

  /**
   * Initialize the settings service AND the system shortcuts
   */
  async init() {
    if (this.initialized) return true;

    try {
      // logService.info("Initializing settings service");

      // Create store with proper path
      try {
        const appDirPath = await appDataDir();
        this.storeFilePath = `${appDirPath}settings.dat`;
        // logService.info(`Using settings file path: ${this.storeFilePath}`);

        this.store = await load(this.storeFilePath);
        // logService.info("Store instance created successfully");
      } catch (storeError) {
        logService.error(`Failed to create store: ${storeError}`);
        // Try fallback with simple path
        this.store = await load("settings.dat");
        logService.info("Using fallback store path");
      }

      // Load settings from persistent storage
      await this.load();
      this.initialized = true;

      // Ensure autostart state matches settings
      try {
        await this.syncAutostart();
      } catch (autostartError) {
        logService.error(`Autostart sync failed: ${autostartError}`);
        // Don't fail the entire initialization for autostart issues
      }

      // Initialize the system shortcut based on settings
      await this.syncShortcut();

      // logService.info("Settings service initialized successfully");
      return true;
    } catch (error) {
      logService.error(`Failed to initialize settings: ${error}`);

      // Reset to defaults if loading fails
      settingsStore.set(DEFAULT_SETTINGS);
      return false;
    }
  }

  /**
   * Check if the settings service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Load settings from persistent storage
   */
  async load() {
    try {
      if (!this.store) {
        throw new Error("Store is not initialized");
      }

      // Get all settings from store, with defaults as fallback
      // logService.info("Trying to load settings from store");
      const storedSettings = await this.store.get<AppSettings>("settings");
      // logService.info(
      //   `Received stored settings: ${
      //     storedSettings ? "Data exists" : "No data"
      //   }`
      // );

      if (storedSettings) {
        // Merge with defaults to ensure all fields exist
        const mergedSettings = this.mergeWithDefaults(storedSettings);
        settingsStore.set(mergedSettings);
        // logService.info("Loaded and merged settings from store");
      } else {
        // logService.info("No stored settings found, using defaults");
        // Make sure defaults are saved
        await this.save();
      }
    } catch (error) {
      logService.error(`Failed to load settings: ${error}`);
      // Continue with defaults but throw the error so it can be handled
      throw error;
    }
  }

  /**
   * Save current settings to persistent storage
   */
  async save() {
    try {
      if (!this.store) {
        throw new Error("Store is not initialized");
      }

      const currentSettings = get(settingsStore);
      // logService.info("Saving settings to store");
      await this.store.set("settings", currentSettings);
      await this.store.save();
      // logService.info("Settings saved successfully");
      return true;
    } catch (error) {
      logService.error(`Failed to save settings: ${error}`);
      return false;
    }
  }

  /**
   * Get the current settings
   */
  getSettings(): AppSettings {
    return get(settingsStore);
  }

  /**
   * Update a specific section of settings
   */
  async updateSettings<K extends keyof AppSettings>(
    section: K,
    values: Partial<AppSettings[K]>
  ): Promise<boolean> {
    try {
      settingsStore.update((settings) => {
        // Merge new values with existing section
        settings[section] = {
          ...settings[section],
          ...values,
        };
        return settings;
      });

      // Special handling for certain settings
      if (section === "general" && "startAtLogin" in values) {
        try {
          await this.syncAutostart();
        } catch (error) {
          logService.error(`Failed to sync autostart: ${error}`);
          // Continue with saving other settings
        }
      }

      // Save updated settings
      return await this.save();
    } catch (error) {
      logService.error(
        `Failed to update ${String(section)} settings: ${error}`
      );
      return false;
    }
  }

  /**
   * Subscribe to settings changes
   */
  subscribe(callback: (settings: AppSettings) => void) {
    return settingsStore.subscribe(callback);
  }

  /**
   * Sync autostart setting with system
   */
  private async syncAutostart() {
    const settings = get(settingsStore);
    const shouldEnable = settings.general.startAtLogin;

    try {
      // logService.info(`Syncing autostart: should be ${shouldEnable}`);

      // First check the current system status
      const isCurrentlyEnabled = await invoke<boolean>("get_autostart_status");
      // logService.info(`Autostart current status: ${isCurrentlyEnabled}`);

      // If there's a mismatch, update the system setting
      if (shouldEnable !== isCurrentlyEnabled) {
        await invoke("initialize_autostart_from_settings", {
          enable: shouldEnable,
        });
        // logService.info(`Autostart ${shouldEnable ? "enabled" : "disabled"}`);
      }
    } catch (error) {
      logService.error(`Failed to sync autostart setting: ${error}`);
      throw error;
    }
  }

  /**
   * Sync system shortcut with settings
   */
  private async syncShortcut() {
    try {
      const settings = get(settingsStore);
      const { modifier, key } = settings.shortcut;

      // logService.info(`Syncing system shortcut: ${modifier}+${key}`);

      // Call the Rust function to set the shortcut
      await invoke("initialize_shortcut_from_settings", {
        modifier,
        key,
      });

      // logService.info("System shortcut initialized from settings");
    } catch (error) {
      logService.error(`Failed to sync shortcut: ${error}`);
    }
  }

  /**
   * Helper to merge stored settings with defaults
   */
  private mergeWithDefaults(stored: unknown): AppSettings {
    try {
      // Ensure stored is an object
      if (!stored || typeof stored !== "object") {
        logService.error("Stored settings not an object, using defaults");
        return { ...DEFAULT_SETTINGS };
      }

      const typedStored = stored as Partial<AppSettings>;

      // Deep merge to ensure all fields exist
      return {
        general: { ...DEFAULT_SETTINGS.general, ...typedStored?.general },
        search: { ...DEFAULT_SETTINGS.search, ...typedStored?.search },
        shortcut: { ...DEFAULT_SETTINGS.shortcut, ...typedStored?.shortcut },
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          ...typedStored?.appearance,
        },
        // Add extension merging
        extensions: {
          enabled: {
            ...DEFAULT_SETTINGS.extensions.enabled,
            ...typedStored?.extensions?.enabled,
          },
        },
        user: typedStored?.user,
      };
    } catch (error) {
      logService.error(`Error merging settings: ${error}`);
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Update extension enabled state
   * @param extensionName Name of the extension
   * @param enabled Whether the extension should be enabled
   * @returns Success status
   */
  async updateExtensionState(
    extensionName: string,
    enabled: boolean
  ): Promise<boolean> {
    try {
      settingsStore.update((settings) => {
        // Make sure extensions.enabled exists
        if (!settings.extensions) {
          settings.extensions = { enabled: {} };
        } else if (!settings.extensions.enabled) {
          settings.extensions.enabled = {};
        }

        // Set the extension state
        settings.extensions.enabled[extensionName] = enabled;
        return settings;
      });

      // Save updated settings
      return await this.save();
    } catch (error) {
      logService.error(`Failed to update extension state: ${error}`);
      return false;
    }
  }

  /**
   * Remove an extension's state entirely
   * @param extensionName Name of the extension to remove
   * @returns Success status
   */
  async removeExtensionState(extensionName: string): Promise<boolean> {
    try {
      settingsStore.update((settings) => {
        if (settings.extensions && settings.extensions.enabled) {
          // Remove the extension entry from enabled states
          delete settings.extensions.enabled[extensionName];
        }
        return settings;
      });

      // Save updated settings
      return await this.save();
    } catch (error) {
      logService.error(`Failed to remove extension state: ${error}`);
      return false;
    }
  }

  /**
   * Check if an extension is enabled
   * @param extensionName Name of the extension to check
   * @returns Whether the extension is enabled (defaults to true if not set)
   */
  isExtensionEnabled(extensionName: string): boolean {
    const settings = get(settingsStore);
    // Default to enabled if not explicitly set to false
    return settings.extensions?.enabled?.[extensionName] !== false;
  }

  /**
   * Get all extension states
   * @returns Record of extension names to enabled states
   */
  getExtensionStates(): Record<string, boolean> {
    return get(settingsStore).extensions?.enabled || {};
  }
}

// Create and export a singleton instance
export const settingsService: ISettingsService = new SettingsService();

// Export the store for reactive access
export const settings = settingsStore;
