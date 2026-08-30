import { onMount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { updateShortcut } from '../../utils/shortcutManager';
import { goto } from '$app/navigation';
import {
  settingsService,
  settings as settingsStore,
} from '../../services/settings/settingsService.svelte';
import extensionManager from '../../services/extension/extensionManager.svelte';
import { extensionStateManager } from '../../services/extension/extensionStateManager.svelte';
import { extensionPreferencesService } from '../../services/extension/extensionPreferencesService.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { permissionConsentService } from '../../services/extension/permissionConsentService.svelte';
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
  permissions?: string[];
  permissionArgs?: Record<string, unknown>;
}

// Initialize with default settings first
export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    startAtLogin: false,
    showDockIcon: false,
    showTrayIcon: true,
    escapeInViewBehavior: 'go-back',
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
    modifier: 'Super',
    key: 'K',
  },
  appearance: {
    theme: 'system' as const,
    launchView: 'default' as const,
    windowWidth: 800,
    windowHeight: 600,
    activeTheme: null,
  },
  extensions: {
    enabled: {},
    autoUpdate: true,
  },
  onboarding: {
    completed: false,
  },
  feedback: {
    promptSeen: false,
  },
  updates: {
    channel: 'stable' as const,
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
    temperature: 0.7,
    maxTokens: 2048,
    defaultAgentId: null,
    tabContinuesLastThread: false,
  },
  developer: {
    enabled: false,
    showInspector: false,
    verboseLogging: false,
    tracing: false,
    allowSideloading: false,
  },
  privacy: {
    crashReportMode: 'off',
    usageShareMode: 'off',
  },
  fileSearch: {
    enabled: true,
    includeRoots: [],
    excludePatterns: [],
    indexHidden: false,
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
  /**
   * Extension id a deep link (asyar:navigate-settings-tab) asked to select.
   * Consumed and cleared by ExtensionsTab once the list is loaded.
   */
  pendingExtensionSelection = $state<string | null>(null);

  private unsubscribe: (() => void) | null = null;
  private unlistenPreferencesChanged: (() => void) | null = null;
  private unlistenConsentChanged: (() => void) | null = null;
  private unlistenExtensionsUpdated: (() => void) | null = null;
  private unlistenWindowFocus: (() => void) | null = null;
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
        logService.error('Settings initialization failed');
        this.initError = 'Settings initialization failed. Using defaults.';
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
          },
        );
      } catch (err) {
        logService.warn(`Failed to subscribe to asyar:preferences-changed: ${err}`);
      }

      // Consent granted/revoked in another webview (e.g. Store install in
      // the main window) must still clear this window's "needs review" badge.
      try {
        const { listen } = await import('@tauri-apps/api/event');
        this.unlistenConsentChanged = await listen<{ extensionId: string }>(
          'asyar:consent-changed',
          (event) => {
            if (!event.payload?.extensionId) return;
            permissionConsentService.consentVersion += 1;
          },
        );
      } catch (err) {
        logService.warn(`Failed to subscribe to asyar:consent-changed: ${err}`);
      }

      // Cross-webview install/uninstall/update notifications. The Rust side
      // emits this after every extension install/uninstall/update, but it
      // only reaches windows that are actually listening for it.
      try {
        const { listen } = await import('@tauri-apps/api/event');
        this.unlistenExtensionsUpdated = await listen('extensions_updated', () => {
          void this.loadExtensions();
        });
      } catch (err) {
        logService.warn(`Failed to subscribe to extensions_updated: ${err}`);
      }

      // The settings window is a persistent hidden webview — it's shown/
      // hidden rather than destroyed/recreated on close, so `onMount` (and
      // its one-shot `loadExtensions()` call above) never runs again after
      // the first open. Extensions installed via `asyar link` bypass the
      // running app entirely (no Tauri event at all), so the only reliable
      // way to pick those up is a fresh rescan whenever this window regains
      // focus, i.e. whenever the user reopens Settings.
      try {
        const unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) void this.loadExtensions();
        });
        this.unlistenWindowFocus = unlisten;
      } catch (err) {
        logService.warn(`Failed to subscribe to settings window focus: ${err}`);
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
    this.unlistenConsentChanged?.();
    this.unlistenConsentChanged = null;
    this.unlistenExtensionsUpdated?.();
    this.unlistenExtensionsUpdated = null;
    this.unlistenWindowFocus?.();
    this.unlistenWindowFocus = null;
  }

  async loadExtensions() {
    // extensions_updated and window-focus can fire close together (e.g.
    // installing from the store while Settings is visible, then refocusing
    // it) — skip a redundant overlapping rescan rather than racing two
    // invoke() calls against each other.
    if (this.isLoadingExtensions) return;

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
        .filter((ext: unknown) => {
          const typed = ext as ExtensionItem;
          const key = typed.id ?? typed.title;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((ext: unknown) => {
          const typed = ext as ExtensionItem;
          return {
            ...typed,
            commands: typed.commands ?? [],
          };
        });

      for (const ext of this.extensions) {
        if (!ext.id) continue;
        const extPrefs: PreferenceDeclaration[] = (ext.preferences ??
          []) as PreferenceDeclaration[];
        const cmdPrefs: Record<string, PreferenceDeclaration[]> = {};
        for (const cmd of ext.commands ?? []) {
          if (cmd && typeof cmd === 'object' && 'preferences' in cmd) {
            const maybePrefs = cmd.preferences;
            if (Array.isArray(maybePrefs) && maybePrefs.length > 0) {
              cmdPrefs[cmd.id] = maybePrefs as PreferenceDeclaration[];
            }
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
      // Enabling grants the declared permission set — require consent first.
      // No-op when a covering consent record exists or nothing is declared.
      if (newState && !extension.isBuiltIn && extension.id) {
        const consented = await permissionConsentService.ensureConsent(
          extension.id,
          extension.title,
          'enable',
        );
        if (!consented) return;
      }

      // Rust's set_extension_enabled is keyed by manifest id, not display title.
      const success = await extensionManager.toggleExtensionState(
        extension.id ?? extension.title,
        newState,
      );

      if (success) {
        extension.enabled = newState;
        this.saveMessage = 'Extension settings updated.';
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
        throw new Error('Extension ID not available');
      }

      const success = await extensionManager.uninstallExtension(extensionId);

      if (success) {
        this.extensions = this.extensions.filter((ext) => ext.title !== extensionName);
        this.saveMessage = `Extension "${extensionName}" uninstalled successfully.`;
        this.saveError = false;
      } else {
        throw new Error('Failed to uninstall extension');
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
        startAtLogin: !this.settings.general.startAtLogin,
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

  async handleDockIconToggle() {
    try {
      const success = await settingsService.updateSettings('general', {
        showDockIcon: !this.settings.general.showDockIcon,
      });

      if (!success) {
        throw new Error('Failed to update dock icon setting');
      }
    } catch (error) {
      logService.error(`Failed to update dock icon setting: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update dock icon setting';

      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }

  async handleTrayIconToggle() {
    try {
      const success = await settingsService.updateSettings('general', {
        showTrayIcon: !this.settings.general.showTrayIcon,
      });

      if (!success) {
        throw new Error('Failed to update menu bar icon setting');
      }
    } catch (error) {
      logService.error(`Failed to update menu bar icon setting: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update menu bar icon setting';

      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }

  async handleExtensionSearchToggle() {
    try {
      const success = await settingsService.updateSettings('search', {
        enableExtensionSearch: !this.settings.search.enableExtensionSearch,
      });
      if (success) {
        this.saveMessage =
          'Search settings updated. Please restart Asyar for these changes to take effect.';
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
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }

  async handleExtensionAutoUpdateToggle() {
    try {
      const autoUpdate = this.settings.extensions?.autoUpdate !== false;
      const success = await settingsService.updateSettings('extensions', {
        autoUpdate: !autoUpdate,
      });
      if (!success) throw new Error('Failed to update extension auto-update setting');
    } catch (error) {
      logService.error(`Failed to update extension auto-update setting: ${error}`);
      this.saveError = true;
      this.saveMessage = 'Failed to update auto-update setting';
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }

  async updateEscapeBehavior(behavior: 'go-back' | 'close-window' | 'hide-and-reset') {
    try {
      const success = await settingsService.updateSettings('general', {
        escapeInViewBehavior: behavior,
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

  async handleSetDefaultAgentId(agentId: string | null): Promise<void> {
    try {
      await settingsService.updateSettings('ai', { defaultAgentId: agentId });
    } catch (error) {
      logService.error(`Failed to update default agent: ${error}`);
    }
  }

  async handleToggleTabContinuesLastThread(value: boolean): Promise<void> {
    try {
      await settingsService.updateSettings('ai', { tabContinuesLastThread: value });
    } catch (error) {
      logService.error(`Failed to update tab continues last thread: ${error}`);
    }
  }

  async updateChannel(channel: 'stable' | 'beta') {
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
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }

  async handleDeveloperSettingToggle(
    key: 'showInspector' | 'verboseLogging' | 'tracing' | 'allowSideloading',
  ) {
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
      setTimeout(() => {
        this.saveMessage = '';
        this.saveError = false;
      }, 3000);
    }
  }
}
