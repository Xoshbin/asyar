import { onMount } from 'svelte';
import { getAvailableModifiers, getAvailableKeys, updateShortcut } from '../../utils/shortcutManager';
import { goto } from '$app/navigation';
import { settingsService, settings as settingsStore } from '../../services/settings/settingsService.svelte';
import extensionManager from '../../services/extension/extensionManager.svelte';
import { extensionStateManager } from '../../services/extension/extensionStateManager.svelte';
import type { AppSettings } from '../../services/settings/types/AppSettingsType';
import { logService } from '../../services/log/logService';
import type { CompatibilityStatus } from '../../types/CompatibilityStatus';

// Define interface for extension items with enabled status
export interface ExtensionItem {
  title: string;
  subtitle?: string;
  keywords?: string;
  type?: string;
  iconUrl?: string;
  version?: string;
  action?: () => void;
  enabled?: boolean;
  id?: string;
  compatibility?: CompatibilityStatus;
}

// Initialize with default settings first
export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    startAtLogin: false,
    showDockIcon: true,
  },
  search: {
    searchApplications: true,
    searchSystemPreferences: true,
    fuzzySearch: true,
    enableExtensionSearch: false,
  },
  shortcut: {
    modifier: "Super",
    key: "K",
  },
  appearance: {
    theme: "system" as const,
    windowWidth: 800,
    windowHeight: 600,
  },
  extensions: {
    enabled: {}
  },
  calculator: {
    refreshInterval: 6
  }
};

export class SettingsHandler {
  // Reactive state
  settings = $state<AppSettings>({ ...DEFAULT_SETTINGS });
  selectedModifier = $state('Super');
  selectedKey = $state('K');
  isSaving = $state(false);
  saveMessage = $state('');
  saveError = $state(false);
  activeTab = $state('general');
  selectedTheme = $state('system');
  isLoading = $state(true);
  initError = $state('');
  
  // Extensions state
  extensions = $state<ExtensionItem[]>([]);
  isLoadingExtensions = $state(false);
  extensionError = $state('');
  togglingExtension = $state<string | null>(null);

  // Uninstall extension state
  uninstallDialogOpen = $state(false);
  extensionToUninstall = $state<ExtensionItem | null>(null);

  // Constants
  readonly modifiers = getAvailableModifiers();
  readonly keys = getAvailableKeys();

  private unsubscribe: (() => void) | null = null;

  constructor() {
    // Initial sync from DEFAULT_SETTINGS handled by property initializers
  }

  async init() {
    try {
      // Initialize with defaults first to avoid blank UI
      this.settings = { ...DEFAULT_SETTINGS };
      this.selectedModifier = this.settings.shortcut.modifier;
      this.selectedKey = this.settings.shortcut.key;
      this.selectedTheme = this.settings.appearance.theme;
      
      // Initialize settings service
      const success = await settingsService.init();
      
      if (!success) {
        logService.error("Settings initialization failed");
        this.initError = "Settings initialization failed. Using defaults.";
      } else {
        // Get the initialized settings
        this.settings = settingsService.getSettings();
        
        // Set local state from settings
        this.selectedModifier = this.settings.shortcut.modifier;
        this.selectedKey = this.settings.shortcut.key;
        this.selectedTheme = this.settings.appearance.theme;
      }

      this.setupSubscription();
    } catch (error) {
      logService.error(`Failed to load settings: ${error}`);
      this.initError = 'Failed to load settings. Using defaults.';
    } finally {
      this.isLoading = false;
      // Apply theme class to body
      document.body.classList.add('settings-page');
      
      // Load extensions data
      await this.loadExtensions();
    }
  }

  private setupSubscription() {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = settingsStore.subscribe((newSettings: AppSettings) => {
      if (newSettings) {
        this.settings = newSettings;
      }
    });
  }

  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  async loadExtensions() {
    this.isLoadingExtensions = true;
    this.extensionError = '';
    
    try {
      this.extensions = await extensionManager.getAllExtensionsWithState();
    } catch (error) {
      logService.error(`Failed to load extensions: ${error}`);
      this.extensionError = 'Failed to load extensions information.';
      this.extensions = [];
    } finally {
      this.isLoadingExtensions = false;
    }
  }

  async toggleExtension(extension: ExtensionItem) {
    if (this.togglingExtension === extension.title) return;
    
    this.togglingExtension = extension.title;
    const newState = !extension.enabled;
    
    try {
      const success = await extensionManager.toggleExtensionState(extension.title, newState);
      
      if (success) {
        extension.enabled = newState;
        this.saveMessage = 'Extension settings updated. Restart Asyar to apply changes.';
        this.saveError = false;
        
        setTimeout(() => {
          this.saveMessage = '';
        }, 5000);
      } else {
        throw new Error('Failed to update extension state');
      }
    } catch (error) {
      logService.error(`Failed to toggle extension ${extension.title}: ${error}`);
      this.saveMessage = 'Failed to update extension settings.';
      this.saveError = true;
      
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false; 
      }, 3000);
    } finally {
      this.togglingExtension = null;
    }
  }

  openUninstallDialog(extension: ExtensionItem) {
    this.extensionToUninstall = extension;
    this.uninstallDialogOpen = true;
  }

  async uninstallExtension() {
    if (!this.extensionToUninstall) return;
    
    try {
      const extensionName = this.extensionToUninstall.title;
      const extensionId = this.extensionToUninstall.id;
      
      if (!extensionId) {
        throw new Error("Extension ID not available");
      }

      const success = await extensionManager.uninstallExtension(extensionId);

      if (success) {
        this.extensions = this.extensions.filter(ext => ext.title !== extensionName);
        this.saveMessage = `Extension "${extensionName}" uninstalled successfully.`;
        this.saveError = false;
      } else {
        throw new Error("Failed to uninstall extension");
      }
    } catch (error) {
      logService.error(`Error uninstalling extension: ${error}`);
      this.saveMessage = 'Failed to uninstall extension.';
      this.saveError = true;
    } finally {
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
      
      this.extensionToUninstall = null;
    }
  }

  async saveShortcutSettings() {
    this.isSaving = true;
    this.saveMessage = '';
    this.saveError = false;

    try {
      const success = await updateShortcut(this.selectedModifier, this.selectedKey);
      
      if (success) {
        this.saveMessage = 'Shortcut saved successfully';
      } else {
        throw new Error('Failed to update shortcut');
      }
    } catch (error) {
      logService.error(`Error saving shortcut: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to save shortcut';
    } finally {
      this.isSaving = false;
      setTimeout(() => {
        this.saveMessage = '';
      }, 3000);
    }
  }

  async handleAutostartToggle() {
    try {
      const success = await settingsService.updateSettings('general', {
        startAtLogin: !this.settings.general.startAtLogin
      });
      
      if (!success) {
        throw new Error('Failed to update autostart setting');
      }
    } catch (error) {
      logService.error(`Failed to update autostart setting: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update startup setting';
      
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }

  async handleExtensionSearchToggle() {
    try {
      const success = await settingsService.updateSettings('search', {
        enableExtensionSearch: !this.settings.search.enableExtensionSearch
      });
      if (success) {
        this.saveMessage = 'Search settings updated. Please restart Asyar for these changes to take effect.';
        this.saveError = false;
      } else {
        throw new Error('Failed to update extension search setting');
      }
    } catch (error) {
      logService.error(`Failed to update extension search setting: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update search setting';
    } finally {
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 5000);
    }
  }

  async updateCalculatorRefreshInterval(hours: number) {
    try {
      const success = await settingsService.updateSettings('calculator', {
        refreshInterval: hours
      });
      
      if (!success) {
        throw new Error('Failed to update refresh interval setting');
      }
    } catch (error) {
      logService.error(`Failed to update refresh interval setting: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update setting';
      
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }

  async updateEscapeBehavior(behavior: 'go-back' | 'close-window') {
    try {
      const success = await settingsService.updateSettings('general', {
        escapeInViewBehavior: behavior
      });
      
      if (!success) {
        throw new Error('Failed to update escape behavior setting');
      }
    } catch (error) {
      logService.error(`Failed to update escape behavior setting: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update setting';
      
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }

  async updateThemeSetting(theme: AppSettings['appearance']['theme']) {
    try {
      await settingsService.updateSettings('appearance', { theme });
      this.selectedTheme = theme;
    } catch (error) {
      logService.error(`Failed to update theme: `);
      this.saveError = true;
      this.saveMessage = 'Failed to update theme';
      
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }

  goBack() {
    goto('/');
  }
}
