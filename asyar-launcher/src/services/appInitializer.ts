import { logService } from './log/logService';
import { authService } from './auth/authService.svelte';
import { cloudSyncService } from './sync/cloudSyncService.svelte';

import { performanceService } from './performance/performanceService.svelte';
import { ClipboardHistoryService } from './clipboard/clipboardHistoryService';
import { applicationService } from './application/applicationsService';
import extensionManager from './extension/extensionManager.svelte';
import { commandService } from './extension/commandService.svelte'; // Import commandService instance
import { searchStores } from './search/stores/search.svelte'; // Import searchStores
import { settingsService } from './settings/settingsService.svelte';
import { envService } from './envService';
import { browserShimService } from './browserShimService';
import { type Event, listen } from '@tauri-apps/api/event';
import * as commands from '../lib/ipc/commands';
import { shortcutService } from '../built-in-features/shortcuts/shortcutService';
import { shortcutStore } from '../built-in-features/shortcuts/shortcutStore.svelte';
import { snippetStore } from '../built-in-features/snippets/snippetStore.svelte';
import { snippetService } from '../built-in-features/snippets/snippetService';
import { portalStore } from '../built-in-features/portals/portalStore.svelte';
import { profileService } from './profile/profileService';
import { extensionUpdateService } from './extension/extensionUpdateService.svelte';
import { extensionOAuthService } from './oauth/extensionOAuthService.svelte';
import { SnippetsSyncProvider } from './profile/providers/snippetsSyncProvider';
import { ShortcutsSyncProvider } from './profile/providers/shortcutsSyncProvider';
import { PortalsSyncProvider } from './profile/providers/portalsSyncProvider';
import { SettingsSyncProvider } from './profile/providers/settingsSyncProvider';
import { ClipboardSyncProvider } from './profile/providers/clipboardSyncProvider';
import { AISettingsSyncProvider } from './profile/providers/aiSettingsSyncProvider';
import { AIConversationsSyncProvider } from './profile/providers/aiConversationsSyncProvider';
import { ExtensionsSyncProvider } from './profile/providers/extensionsSyncProvider';
import { ExtensionPreferencesSyncProvider } from './profile/providers/extensionPreferencesSyncProvider';
import { systemEventsBridge } from './systemEvents/systemEventsBridge.svelte';
import { appEventsBridge } from './appEvents/appEventsBridge.svelte';
import { trayClickBridge } from './statusBar/trayClickBridge.svelte';
import { extensionIframeRegistry } from './extension/extensionIframeRegistry.svelte';
import { extensionReadinessListener } from './extension/extensionReadinessListener';

// Flag to prevent multiple initializations
let isInitialized = false;

/**
 * Registers all core profile sync providers.
 * Idempotent — safe to call from any window context (main launcher or settings window).
 */
export function registerProfileProviders(): void {
  if (profileService.getProviders().length > 0) return;
  profileService.registerProvider(new SettingsSyncProvider());
  profileService.registerProvider(new SnippetsSyncProvider());
  profileService.registerProvider(new ShortcutsSyncProvider());
  profileService.registerProvider(new PortalsSyncProvider());
  profileService.registerProvider(new ClipboardSyncProvider());
  profileService.registerProvider(new AISettingsSyncProvider());
  profileService.registerProvider(new AIConversationsSyncProvider());
  profileService.registerProvider(new ExtensionsSyncProvider());
  profileService.registerProvider(new ExtensionPreferencesSyncProvider());
}

export const appInitializer = {
  async init(): Promise<boolean> {
    if (isInitialized) {
      logService.warn("Application already initialized.");
      return true;
    }
    isInitialized = true; // Set early to prevent concurrent calls

    try {
      logService.info(`Application starting initialization...`);

      // Initialize browser shims for non-Tauri environments
      browserShimService.init();

      // Initialize auth (load cached token + background entitlement refresh)
      if (envService.isTauri) {
        await authService.init();
        logService.info('Auth service initialized.');

        await extensionOAuthService.init();
        logService.info('Extension OAuth service initialized.');
      }

      // Register profile sync providers before cloud sync so the initial upload has all providers
      registerProfileProviders();
      logService.info('Profile sync providers registered.');

      // Initialize cloud sync — background, do not block startup
      if (envService.isTauri) {
        cloudSyncService.init().catch((err: any) => {
          logService.warn(`Cloud sync init failed: ${err}`);
        });
        logService.info('Cloud sync service initialized.');
      }

      // Initialize performance service first
      await performanceService.init();

      logService.custom("🔍 Performance monitoring initialized", "PERF", "cyan", "cyan");
      performanceService.logPerformanceReport(); // Initial report

      // Initialize core services
      if (envService.isTauri) {
        // Initialize Clipboard History
        const clipboardHistoryService = ClipboardHistoryService.getInstance();
        await clipboardHistoryService.initialize();
        logService.info(`Clipboard history service initialized.`);

        await applicationService.init();
      } else {
        logService.warn("Browser mode: Skipping Clipboard and Application indexing.");
      }

      // Initialize stores before extensionManager so extensions see real persisted data in initialize()
      if (envService.isTauri) {
        await shortcutStore.init();
        await snippetStore.init();
        await portalStore.init();

        // After a cloud restore from the settings window, reload stores so the main window
        // picks up the newly written data without requiring a full restart.
        listen<void>('asyar:stores-restored', async () => {
          await shortcutStore.reload();
          await snippetStore.reload();
          await portalStore.reload();
          logService.info('Stores reloaded after cloud restore.');
        }).catch((err: any) => {
          logService.warn(`Failed to register stores-restored listener: ${err}`);
        });
      }

      // Bridge Rust `asyar:system-event` push events to extension iframes.
      // Must be ready before extensions initialize so early subscriptions
      // don't race the first emit.
      if (envService.isTauri) {
        systemEventsBridge.init().catch((err: any) => {
          logService.warn(`systemEventsBridge init failed: ${err}`);
        });
        appEventsBridge.init().catch((err: any) => {
          logService.warn(`appEventsBridge init failed: ${err}`);
        });
        trayClickBridge.init().catch((err: any) => {
          logService.warn(`trayClickBridge init failed: ${err}`);
        });
      }

      await extensionManager.init(); // Initialize ExtensionManager first

      // Initialize extension update service for silent auto-updates
      const { viewManager } = await import('./extension/viewManager.svelte');
      await extensionUpdateService.init(
        () => {
          const activeView = viewManager.getActiveView();
          return activeView ? activeView.split('/')[0] : null;
        },
        () => extensionManager.reloadExtensions(),
      );
      extensionUpdateService.checkAndAutoApply(); // non-blocking initial check + auto-apply
      commandService.initialize(extensionManager); // Initialize CommandService with ExtensionManager instance

      // Initialize app auto-update store (listens for Rust scheduler events)
      if (envService.isTauri) {
        const { initAppUpdateStore } = await import('./update/appUpdateStore.svelte')
        await initAppUpdateStore()
        logService.info('App update store initialized.')
      }

      // Check whether to show What's New panel (shown once after each update)
      if (envService.isTauri) {
        try {
          const { getVersion } = await import('@tauri-apps/api/app')
          const { invoke } = await import('@tauri-apps/api/core')
          const { whatsNewStore } = await import('./update/whatsNewStore.svelte')
          const currentVersion = await getVersion()
          const lastSeen = settingsService.currentSettings.updates?.lastSeenVersion
          if (lastSeen == null) {
            // Fresh install — record silently so next update shows the panel
            await settingsService.updateSettings('updates', { lastSeenVersion: currentVersion })
          } else {
            const shouldShow = await invoke<boolean>('app_updater_should_show_whats_new', {
              lastSeenVersion: lastSeen,
              currentVersion,
            })
            if (shouldShow) {
              whatsNewStore.version = currentVersion
            }
          }
          logService.info("What's New check complete.")
        } catch (e) {
          logService.warn(`What's New check failed: ${e}`)
        }
      }

      // Initialize Tier 2 iframe mount/unmount registry + SDK-ready listener.
      // The registry listens for asyar:iframe:{mount,unmount} Tauri events from
      // Rust and drives BackgroundExtensionIframes. The readiness listener
      // handles asyar:extension:loaded postMessages from SDK iframes and drains
      // the Rust-side mailbox.
      if (envService.isTauri) {
        void extensionIframeRegistry.init();
        extensionReadinessListener.init();
      }

      // Initialize extension deeplink service (asyar://extensions/{extId}/{cmdId})
      if (envService.isTauri) {
        const { createDeeplinkService } = await import('./deeplink/deeplinkService.svelte');
        const deeplinkService = createDeeplinkService({
          getManifestById: (id) => extensionManager.getManifestById(id),
          isExtensionEnabled: (id) => extensionManager.isExtensionEnabled(id),
          hasCommand: (id) => commandService.commands.has(id),
          executeCommand: (id, args) => commandService.executeCommand(id, args),
          navigateToView: (path) => extensionManager.navigateToView(path),
          showWindow: () => commands.showWindow(),
          recordItemUsage: (id) => commands.recordItemUsage(id),
        });
        await deeplinkService.init();
        logService.info('Extension deeplink service initialized.');
      }

      // Notification action dispatch bridge. Runs on every Tauri instance
      // so clicking a button on an OS notification fires the declared
      // extension command even when the launcher window is hidden.
      if (envService.isTauri) {
        const { NotificationActionBridge } = await import('./notification/notificationActionBridge.svelte');
        const notificationActionBridge = new NotificationActionBridge({
          getManifestById: (id) => extensionManager.getManifestById(id),
          isExtensionEnabled: (id) => extensionManager.isExtensionEnabled(id),
          hasCommand: (id) => commandService.commands.has(id),
          executeCommand: (id, args) => commandService.executeCommand(id, args),
        });
        await notificationActionBridge.init();
        logService.info('Notification action bridge initialized.');
      }

      if (envService.isTauri) {
        await shortcutService.init();
        await snippetService.init();
        listen('user-shortcut-fired', (event) => {
          // Suppress shortcut firing while the ShortcutCapture modal is open.
          // OS shortcuts fire at kernel level before the browser sees the keydown,
          // so preventDefault() in ShortcutCapture cannot stop them. This guard does.
          if (shortcutStore.isCapturing) return;
          shortcutService.handleFiredShortcut(event.payload as string);
        });

        listen<{ keywordLen: number; expansion: string }>('expand-snippet', async (event) => {
          const { keywordLen, expansion } = event.payload;
          await snippetService.expandSnippet(keywordLen, expansion);
        });

        // Apply theme changes triggered from the Settings window
        listen<{ themeId: string | null }>('asyar:theme-changed', async ({ payload }) => {
          const { applyTheme, removeTheme } = await import('./theme/themeService');
          if (payload.themeId) {
            applyTheme(payload.themeId).catch(err => {
              logService.error(`[AppInitializer] Failed to apply theme: ${err}`);
            });
          } else {
            removeTheme();
          }
        });

        // Apply launch-view changes triggered from the Settings window
        listen<{ launchView: 'default' | 'compact' }>('asyar:launch-view-changed', ({ payload }) => {
          settingsService.currentSettings.appearance.launchView = payload.launchView;
        });

        // Pass the payload straight into resync() as an override — the
        // settings-store bridge arrives on a separate IPC channel with no
        // ordering guarantee against this emit.
        listen<{ additionalScanPaths?: string[] }>(
          'asyar:app-scan-paths-changed',
          async ({ payload }) => {
            await applicationService.resync(payload ?? undefined);
          }
        ).catch((err) => {
          logService.warn(`Failed to register app-scan-paths-changed listener: ${err}`);
        });

        // Tray click events are now routed to each extension's own iframe
        // via `trayClickBridge` — each extension owns an independent tray
        // icon (see `extension_tray` in Rust), and handlers are fired
        // inside the extension's SDK proxy. The launcher no longer
        // navigates on tray clicks.
      }

      const serviceInitMetrics = performanceService.stopTiming("service-init");
      logService.custom(`🔌 Core services initialized in ${serviceInitMetrics.duration?.toFixed(2)}ms`, "PERF", "green");

      const initMetrics = performanceService.stopTiming("app-initialization");
      logService.custom(`⚡ App initialized in ${initMetrics.duration?.toFixed(2)}ms`, "PERF", "green", "bgGreen");

      // Log performance report after a short delay
      setTimeout(() => performanceService.logPerformanceReport(), 1000);

      logService.info(`Application initialization complete.`);
      return true;

    } catch (error) {
      logService.error(`Failed to initialize application: ${error}`);
      isInitialized = false; // Reset flag on error
      return false;
    }
  },

  isAppInitialized(): boolean {
    return isInitialized;
  }
};
