import { writable, get } from "svelte/store";
import { Store, load } from "@tauri-apps/plugin-store";
import { LogService } from "./logService";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

// Define settings structure
export interface AppSettings {
  general: {
    startAtLogin: boolean;
    showDockIcon: boolean;
  };
  search: {
    searchApplications: boolean;
    searchSystemPreferences: boolean;
    fuzzySearch: boolean;
  };
  shortcut: {
    modifier: string;
    key: string;
  };
  appearance: {
    theme: "system" | "light" | "dark";
    windowWidth: number;
    windowHeight: number;
  };
  // Reserved for future user-specific settings that might sync to cloud
  user?: {
    id?: string;
    syncEnabled?: boolean;
    lastSynced?: number;
  };
}

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
};

// Create the store
const settingsStore = writable<AppSettings>(DEFAULT_SETTINGS);

// Settings service implementation
class SettingsService {
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
      LogService.info("Initializing settings service");

      // Create store with proper path
      try {
        const appDirPath = await appDataDir();
        this.storeFilePath = `${appDirPath}settings.dat`;
        LogService.info(`Using settings file path: ${this.storeFilePath}`);

        this.store = await load(this.storeFilePath);
        LogService.info("Store instance created successfully");
      } catch (storeError) {
        LogService.error(`Failed to create store: ${storeError}`);
        // Try fallback with simple path
        this.store = await load("settings.dat");
        LogService.info("Using fallback store path");
      }

      // Load settings from persistent storage
      await this.load();
      this.initialized = true;

      // Ensure autostart state matches settings
      try {
        await this.syncAutostart();
      } catch (autostartError) {
        LogService.error(`Autostart sync failed: ${autostartError}`);
        // Don't fail the entire initialization for autostart issues
      }

      // Initialize the system shortcut based on settings
      await this.syncShortcut();

      LogService.info("Settings service initialized successfully");
      return true;
    } catch (error) {
      LogService.error(`Failed to initialize settings: ${error}`);

      // Reset to defaults if loading fails
      settingsStore.set(DEFAULT_SETTINGS);
      return false;
    }
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
      LogService.info("Trying to load settings from store");
      const storedSettings = await this.store.get<AppSettings>("settings");
      LogService.info(
        `Received stored settings: ${
          storedSettings ? "Data exists" : "No data"
        }`
      );

      if (storedSettings) {
        // Merge with defaults to ensure all fields exist
        const mergedSettings = this.mergeWithDefaults(storedSettings);
        settingsStore.set(mergedSettings);
        LogService.info("Loaded and merged settings from store");
      } else {
        LogService.info("No stored settings found, using defaults");
        // Make sure defaults are saved
        await this.save();
      }
    } catch (error) {
      LogService.error(`Failed to load settings: ${error}`);
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
      LogService.info("Saving settings to store");
      await this.store.set("settings", currentSettings);
      await this.store.save();
      LogService.info("Settings saved successfully");
      return true;
    } catch (error) {
      LogService.error(`Failed to save settings: ${error}`);
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
          LogService.error(`Failed to sync autostart: ${error}`);
          // Continue with saving other settings
        }
      }

      // Save updated settings
      return await this.save();
    } catch (error) {
      LogService.error(
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
      LogService.info(`Syncing autostart: should be ${shouldEnable}`);

      // First check the current system status
      const isCurrentlyEnabled = await invoke<boolean>("get_autostart_status");
      LogService.info(`Autostart current status: ${isCurrentlyEnabled}`);

      // If there's a mismatch, update the system setting
      if (shouldEnable !== isCurrentlyEnabled) {
        await invoke("initialize_autostart_from_settings", {
          enable: shouldEnable,
        });
        LogService.info(`Autostart ${shouldEnable ? "enabled" : "disabled"}`);
      }
    } catch (error) {
      LogService.error(`Failed to sync autostart setting: ${error}`);
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

      LogService.info(`Syncing system shortcut: ${modifier}+${key}`);

      // Call the Rust function to set the shortcut
      await invoke("initialize_shortcut_from_settings", {
        modifier,
        key,
      });

      LogService.info("System shortcut initialized from settings");
    } catch (error) {
      LogService.error(`Failed to sync shortcut: ${error}`);
    }
  }

  /**
   * Helper to merge stored settings with defaults
   */
  private mergeWithDefaults(stored: unknown): AppSettings {
    try {
      // Ensure stored is an object
      if (!stored || typeof stored !== "object") {
        LogService.error("Stored settings not an object, using defaults");
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
        user: typedStored?.user,
      };
    } catch (error) {
      LogService.error(`Error merging settings: ${error}`);
      return { ...DEFAULT_SETTINGS };
    }
  }
}

// Create and export a singleton instance
export const settingsService = new SettingsService();

// Export the store for reactive access
export const settings = settingsStore;
