import { Store, load } from "@tauri-apps/plugin-store";
import { logService } from "../log/logService";
import { appDataDir } from "@tauri-apps/api/path";
import { getVersion } from "@tauri-apps/api/app";
import * as commands from "../../lib/ipc/commands";
import type { ISettingsService } from "./interfaces/ISettingsService";
import type { AppSettings } from "./types/AppSettingsType";

// Default settings
const DEFAULT_SETTINGS: AppSettings = {
  general: {
    startAtLogin: false,
    showDockIcon: true,
    escapeInViewBehavior: "close-window",
  },
  search: {
    searchApplications: true,
    searchSystemPreferences: true,
    fuzzySearch: true,
    enableExtensionSearch: false, // Off by default
  },
  shortcut: {
    modifier: "Alt",
    key: "Space",
  },
  appearance: {
    theme: "system",
    windowWidth: 800,
    windowHeight: 600,
  },
  extensions: {
    enabled: {},
    autoUpdate: true,
  },
  calculator: {
    refreshInterval: 6,
  },
  updates: {
    channel: "stable" as const,
  },
};

// Settings service implementation
class SettingsService implements ISettingsService {
  private initialized = false;
  private store: Store | null = null;
  private storeFilePath = "settings.dat";

  // Svelte 5 reactive state
  public currentSettings = $state<AppSettings>(DEFAULT_SETTINGS);

  /**
   * Initialize the settings service AND the system shortcuts
   */
  async init() {
    if (this.initialized) return true;

    try {
      // Create store with proper path
      try {
        const appDirPath = await appDataDir();
        this.storeFilePath = `${appDirPath}settings.dat`;
        this.store = await load(this.storeFilePath);
      } catch (storeError) {
        logService.error(`Failed to create store: ${storeError}`);
        // Try fallback with simple path
        this.store = await load("settings.dat");
        logService.info("Using fallback store path");
      }

      // Load settings from persistent storage
      const storedRaw = await this.store.get<AppSettings>("settings");
      await this.load();
      this.initialized = true;

      // Auto-detect update channel on first launch after upgrading from an old
      // settings.dat that lacked the 'updates' key. Only fires once.
      if (storedRaw && (storedRaw as Partial<AppSettings>).updates === undefined) {
        try {
          const version = await getVersion();
          if (/-/.test(version)) {
            this.currentSettings.updates = { channel: "beta" };
            await this.save();
          }
        } catch {
          // Non-fatal: version detection failed, keep stable default
        }
      }

      // Ensure autostart state matches settings
      try {
        await this.syncAutostart();
      } catch (autostartError) {
        logService.error(`Autostart sync failed: ${autostartError}`);
      }

      // Initialize the system shortcut based on settings
      await this.syncShortcut();

      return true;
    } catch (error) {
      logService.error(`Failed to initialize settings: ${error}`);
      this.currentSettings = DEFAULT_SETTINGS;
      return false;
    }
  }

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

      const storedSettings = await this.store.get<AppSettings>("settings");
      if (storedSettings) {
        // Merge with defaults to ensure all fields exist
        this.currentSettings = this.mergeWithDefaults(storedSettings);
      } else {
        await this.save();
      }
    } catch (error) {
      logService.error(`Failed to load settings: ${error}`);
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

      await this.store.set("settings", $state.snapshot(this.currentSettings));
      await this.store.save();
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
    return this.currentSettings;
  }

  /**
   * Update a specific section of settings
   */
  async updateSettings<K extends keyof AppSettings>(
    section: K,
    values: Partial<AppSettings[K]>
  ): Promise<boolean> {
    try {
      // Update reactive state
      this.currentSettings[section] = {
        ...this.currentSettings[section],
        ...values,
      } as AppSettings[K];

      // Special handling for certain settings
      if (section === "general" && "startAtLogin" in values) {
        try {
          await this.syncAutostart();
        } catch (error) {
          logService.error(`Failed to sync autostart: ${error}`);
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
   * Subscribe for backward compatibility (ISettingsService compatibility)
   */
  subscribe(callback: (settings: AppSettings) => void) {
    // This is a minimal implementation for the interface
    // In Svelte 5, consumers should ideally use $state properties directly
    const unsub = $effect.root(() => {
      $effect(() => {
        callback(this.currentSettings);
      });
    });
    return unsub;
  }

  /**
   * Sync autostart setting with system
   */
  private async syncAutostart() {
    const shouldEnable = this.currentSettings.general.startAtLogin;

    try {
      const isCurrentlyEnabled = await commands.getAutostartStatus();
      if (shouldEnable !== isCurrentlyEnabled) {
        await commands.initializeAutostartFromSettings(shouldEnable);
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
      const { modifier, key } = this.currentSettings.shortcut;
      await commands.initializeShortcutFromSettings(modifier, key);
    } catch (error) {
      logService.error(`Failed to sync shortcut: ${error}`);
    }
  }

  private mergeWithDefaults(stored: unknown): AppSettings {
    try {
      if (!stored || typeof stored !== "object") {
        return { ...DEFAULT_SETTINGS };
      }

      const typedStored = stored as Partial<AppSettings>;

      return {
        general: { ...DEFAULT_SETTINGS.general, ...typedStored?.general },
        search: { ...DEFAULT_SETTINGS.search, ...typedStored?.search },
        shortcut: { ...DEFAULT_SETTINGS.shortcut, ...typedStored?.shortcut },
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          ...typedStored?.appearance,
        },
        extensions: {
          enabled: {
            ...DEFAULT_SETTINGS.extensions.enabled,
            ...typedStored?.extensions?.enabled,
          },
        },
        calculator: {
          ...DEFAULT_SETTINGS.calculator,
          ...typedStored?.calculator,
        },
        updates: {
          ...DEFAULT_SETTINGS.updates,
          ...typedStored?.updates,
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
   */
  async updateExtensionState(
    extensionName: string,
    enabled: boolean
  ): Promise<boolean> {
    try {
      if (!this.currentSettings.extensions) {
        this.currentSettings.extensions = { enabled: {} };
      } else if (!this.currentSettings.extensions.enabled) {
        this.currentSettings.extensions.enabled = {};
      }

      this.currentSettings.extensions.enabled[extensionName] = enabled;
      return await this.save();
    } catch (error) {
      logService.error(`Failed to update extension state: ${error}`);
      return false;
    }
  }

  /**
   * Remove an extension's state entirely
   */
  async removeExtensionState(extensionName: string): Promise<boolean> {
    try {
      if (this.currentSettings.extensions && this.currentSettings.extensions.enabled) {
        delete this.currentSettings.extensions.enabled[extensionName];
      }
      return await this.save();
    } catch (error) {
      logService.error(`Failed to remove extension state: ${error}`);
      return false;
    }
  }

  /**
   * Check if an extension is enabled
   */
  isExtensionEnabled(extensionName: string): boolean {
    return this.currentSettings.extensions?.enabled?.[extensionName] !== false;
  }

  /**
   * Get all extension states
   */
  getExtensionStates(): Record<string, boolean> {
    return this.currentSettings.extensions?.enabled || {};
  }
}

// Create and export a singleton instance
export const settingsService = new SettingsService();

// Export the "settings" store for reactive access (legacy support)
export const settings = {
  get subscribe() {
    return (fn: (v: AppSettings) => void) => {
      let isFirst = true;
      const unsub = $effect.root(() => {
        $effect(() => {
          const s = settingsService.currentSettings;
          if (isFirst) {
            fn(s);
            isFirst = false;
          } else {
            fn(s);
          }
        });
      });
      return unsub;
    };
  }
};

export default settingsService;
