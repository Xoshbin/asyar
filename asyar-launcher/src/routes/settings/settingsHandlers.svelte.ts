import { onMount } from 'svelte';
import { updateShortcut } from '../../utils/shortcutManager';
import { goto } from '$app/navigation';
import { settingsService, settings as settingsStore } from '../../services/settings/settingsService.svelte';
import extensionManager from '../../services/extension/extensionManager.svelte';
import { extensionStateManager } from '../../services/extension/extensionStateManager.svelte';
import { extensionPreferencesService } from '../../services/extension/extensionPreferencesService.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import type { AppSettings } from '../../services/settings/types/AppSettingsType';
import { logService } from '../../services/log/logService';
import type { CompatibilityStatus } from '../../types/CompatibilityStatus';
import type { ExtensionCommand, PreferenceDeclaration } from 'asyar-sdk/contracts';

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
  commands?: ExtensionCommand[];
  preferences?: any[];
  isBuiltIn?: boolean;
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
    allowExtensionActions: false,
    additionalScanPaths: [],
    applicationEnabled: {},
  },
  shortcut: {
    modifier: "Super",
    key: "K",
  },
  appearance: {
    theme: "system" as const,
    launchView: "default" as const,
    windowWidth: 800,
    windowHeight: 600,
    activeTheme: null,
  },
  extensions: {
    enabled: {}
  },
  updates: {
    channel: "stable" as const,
    autoCheck: true,
  },
  ai: {
    providers: {
      openai: { enabled: false },
      anthropic: { enabled: false },
      google: { enabled: false },
      ollama: { enabled: false },
      openrouter: { enabled: false },
      custom: { enabled: false },
    },
    activeProviderId: null,
    activeModelId: null,
    temperature: 0.7,
    maxTokens: 2048,
    allowExtensionUse: true,
  },
  developer: {
    enabled: false,
    showInspector: false,
    verboseLogging: false,
    tracing: false,
    allowSideloading: false,
  },
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
  selectedLaunchView = $state<'default' | 'compact'>('default');
  isLoading = $state(true);
  initError = $state('');
  
  // Extensions state
  extensions = $state<ExtensionItem[]>([]);
  isLoadingExtensions = $state(false);
  extensionError = $state('');
  togglingExtension = $state<string | null>(null);


  private unsubscribe: (() => void) | null = null;
  private unlistenPreferencesChanged: (() => void) | null = null;
  /**
   * Bumped whenever an `asyar:preferences-changed` Tauri event arrives.
   * The ExtensionDetailPanel consumes this as a reactive dependency in
   * its preference-loading `$effect`, so a write from any webview
   * triggers the panel to re-fetch the current bundle from Rust.
   */
  preferencesVersion = $state(0);

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
      this.selectedLaunchView = this.settings.appearance.launchView;
      
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
        this.selectedLaunchView = this.settings.appearance.launchView;
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

      // Subscribe to cross-webview preference changes. The settings window
      // is its own Tauri webview with its own JS context — without this,
      // preference writes would only invalidate the cache in the webview
      // that performed them, leaving the other webview stale. The Rust
      // side broadcasts this event to all webviews after every
      // extension_preferences_set / _reset. The preferencesVersion bump
      // is what ExtensionDetailPanel's $effect uses to re-fetch.
      try {
        const { listen } = await import('@tauri-apps/api/event');
        this.unlistenPreferencesChanged = await listen<{ extensionId: string }>(
          'asyar:preferences-changed',
          (event) => {
            const extensionId = event.payload?.extensionId;
            if (!extensionId) return;
            extensionPreferencesService.invalidateCache(extensionId);
            this.preferencesVersion += 1;
          }
        );
      } catch (err) {
        logService.warn(`Failed to subscribe to asyar:preferences-changed: ${err}`);
      }
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
    this.unlistenPreferencesChanged?.();
    this.unlistenPreferencesChanged = null;
  }

  async loadExtensions() {
    this.isLoadingExtensions = true;
    this.extensionError = '';

    try {
      const allExtensions = await extensionManager.getAllExtensionsWithState();
      const seen = new Set<string>();
      // Include built-ins alongside third-party extensions so users can see
      // and configure everything in one place. Built-ins can be toggled but
      // not uninstalled — the detail panel hides the uninstall button based
      // on `isBuiltIn`.
      this.extensions = allExtensions
        .filter((ext: any) => {
          const key = ext.id ?? ext.title;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((ext: any) => ({
          ...ext,
          commands: ext.commands ?? [],
        }));

      // Register preference declarations with extensionPreferencesService.
      // The settings window is a separate Tauri webview with its own JS
      // context — its extensionPreferencesService instance has never been
      // seeded by ExtensionLoader (which only runs in the main window), so
      // without this step `getEffectivePreferences` returns an empty bundle
      // and the detail panel renders blank values.
      for (const ext of this.extensions) {
        if (!ext.id) continue;
        const extPrefs: PreferenceDeclaration[] = (ext.preferences ?? []) as PreferenceDeclaration[];
        const cmdPrefs: Record<string, PreferenceDeclaration[]> = {};
        for (const cmd of ext.commands ?? []) {
          const cmdAny = cmd as any;
          if (cmdAny.preferences && Array.isArray(cmdAny.preferences) && cmdAny.preferences.length > 0) {
            cmdPrefs[cmd.id] = cmdAny.preferences as PreferenceDeclaration[];
          }
        }
        extensionPreferencesService.registerManifest(ext.id, {
          extension: extPrefs,
          commands: cmdPrefs,
        });
      }
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

  async requestUninstallExtension(extension: ExtensionItem) {
    const confirmed = await feedbackService.confirmAlert({
      title: 'Uninstall Extension',
      message: `Are you sure you want to uninstall "${extension.title}"? This action cannot be undone.`,
      confirmText: 'Uninstall',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      const extensionName = extension.title;
      const extensionId = extension.id;

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

  async handleExtensionActionsToggle() {
    try {
      const success = await settingsService.updateSettings('search', {
        allowExtensionActions: !this.settings.search.allowExtensionActions,
      });
      if (!success) throw new Error('Failed to update extension actions setting');
    } catch (error) {
      logService.error(`Failed to update extension actions setting: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update extension actions setting';
      setTimeout(() => { this.saveMessage = ''; this.saveError = false; }, 3000);
    }
  }

  async updateEscapeBehavior(behavior: 'go-back' | 'close-window' | 'hide-and-reset') {
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

  async updateLaunchView(launchView: 'default' | 'compact') {
    try {
      await settingsService.updateSettings('appearance', { launchView });
      this.selectedLaunchView = launchView;
    } catch (error) {
      logService.error(`Failed to update launch view: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update launch view';

      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }

  async updateChannel(channel: "stable" | "beta") {
    await settingsService.updateSettings('updates', { channel });
  }

  async updateAutoCheck(autoCheck: boolean) {
    await settingsService.updateSettings('updates', { autoCheck });
  }

  goBack() {
    goto('/');
  }

  async handleDeveloperModeToggle() {
    try {
      const current = this.settings.developer ?? DEFAULT_SETTINGS.developer!;
      await settingsService.updateSettings('developer', {
        ...current,
        enabled: !current.enabled,
      });
    } catch (error) {
      logService.error(`Failed to toggle developer mode: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update developer mode';
      setTimeout(() => { this.saveMessage = ''; this.saveError = false; }, 3000);
    }
  }

  async handleDeveloperSettingToggle(key: 'showInspector' | 'verboseLogging' | 'tracing' | 'allowSideloading') {
    try {
      const current = this.settings.developer ?? DEFAULT_SETTINGS.developer!;
      await settingsService.updateSettings('developer', {
        ...current,
        [key]: !current[key],
      });
    } catch (error) {
      logService.error(`Failed to toggle developer setting ${key}: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update developer setting';
      setTimeout(() => { this.saveMessage = ''; this.saveError = false; }, 3000);
    }
  }
}
