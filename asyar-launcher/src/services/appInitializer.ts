import { logService } from './log/logService';
import { initProviders } from './ai/initProviders';
import { authService } from './auth/authService.svelte';
import { cloudSyncService } from './sync/cloudSyncService.svelte';

import { performanceService } from './performance/performanceService.svelte';
import { clipboardHistoryService } from './clipboard/clipboardHistoryService';
import { clipboardPrivacyService } from './privacy/clipboardPrivacyService.svelte';
import { secretRedactionService } from './privacy/secretRedactionService.svelte';
import { encryptionService } from './privacy/encryptionService.svelte';
import { applicationService } from './application/applicationsService';
import extensionManager from './extension/extensionManager.svelte';
import { commandService } from './extension/commandService.svelte'; // Import commandService instance
import { onboardingViewInterception } from './extension/onboardingViewInterception';
import { searchStores } from './search/stores/search.svelte'; // Import searchStores
import { settingsService } from './settings/settingsService.svelte';
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
import { ExtensionsSyncProvider } from './profile/providers/extensionsSyncProvider';
import { ExtensionPreferencesSyncProvider } from './profile/providers/extensionPreferencesSyncProvider';
import { systemEventsBridge } from './systemEvents/systemEventsBridge.svelte';
import { appEventsBridge } from './appEvents/appEventsBridge.svelte';
import { indexEventsBridge } from './applicationIndex/indexEventsBridge.svelte';
import { browserEventsBridge } from './browser/browserEventsBridge.svelte';
import { fsWatcherBridge } from './fsWatcher/fsWatcherBridge.svelte';
import { stateChangedBridge } from './extensionState/stateChangedBridge.svelte';
import { rpcReplyBridge } from './extensionState/rpcReplyBridge.svelte';
import { initScanPathsSync } from './application/scanPathsSync.svelte';
import { trayClickBridge } from './statusBar/trayClickBridge.svelte';
import { viewRegistry } from './extension/viewRegistry.svelte';
import { workerRegistry } from './extension/workerRegistry.svelte';
import { extensionReadinessListener } from './extension/extensionReadinessListener';
import { iframeDeliveryListener } from './extension/iframeDeliveryListener.svelte';
import { restoreWorkers } from '../lib/ipc/iframeLifecycleCommands';
import { diagnosticsService } from './diagnostics/diagnosticsService.svelte';
import type { EmojiFallbackPayload } from '../built-in-features/ai/inlineEmojiFallback';

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

      // Register AI provider plugins before any service that may call listProviders()
      initProviders();

      // Initialize auth (load cached token + background entitlement refresh)
      await authService.init();
      logService.info('Auth service initialized.');

      await extensionOAuthService.init();
      logService.info('Extension OAuth service initialized.');

      // Register profile sync providers before cloud sync so the initial upload has all providers
      registerProfileProviders();
      logService.info('Profile sync providers registered.');

      // Initialize cloud sync — background, do not block startup
      cloudSyncService.init().catch((err: any) => {
        logService.warn(`Cloud sync init failed: ${err}`);
      });
      logService.info('Cloud sync service initialized.');

      // Initialize performance service first
      await performanceService.init();

      logService.custom("🔍 Performance monitoring initialized", "PERF", "cyan", "cyan");
      performanceService.logPerformanceReport(); // Initial report

      // Initialize core services
      // Seed the clipboard privacy filter (denylist + session stats) before
      // clipboard monitoring starts, so the very first capture event is
      // already gated against the persisted user denylist.
      await clipboardPrivacyService.init().catch((err: unknown) => {
        logService.warn(`Clipboard privacy init failed: ${err}`);
      });

      // Seed the secret-redaction filter (per-category toggles + catalog)
      // before any clipboard / snippet / AI append fires.
      await secretRedactionService.init().catch((err: unknown) => {
        logService.warn(`Secret redaction init failed: ${err}`);
      });

      // Seed the encryption-status reactive store so the privacy UI
      // can show 'active' / 'fallback' / 'unknown' the moment the
      // user opens settings.
      await encryptionService.init().catch((err: unknown) => {
        logService.warn(`Encryption status init failed: ${err}`);
      });

      // Initialize Clipboard History
      await clipboardHistoryService.initialize();
      logService.info(`Clipboard history service initialized.`);

      // Must precede applicationService.init() — its first scan reads additionalScanPaths.
      await settingsService.init();

      await applicationService.init();

      // Push the user-configured additionalScanPaths down to the Rust
      // IndexWatcher and keep them in sync with settings changes. Runs
      // after `applicationService.init()` so the initial scan already
      // fired — the watcher only needs to know about extras going
      // forward.
      initScanPathsSync();

      // Initialize stores before extensionManager so extensions see real persisted data in initialize()
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

      // Bridge Rust `asyar:system-event` push events to extension iframes.
      // Must be ready before extensions initialize so early subscriptions
      // don't race the first emit.
      systemEventsBridge.init().catch((err: any) => {
        logService.warn(`systemEventsBridge init failed: ${err}`);
      });
      appEventsBridge.init().catch((err: any) => {
        logService.warn(`appEventsBridge init failed: ${err}`);
      });
      indexEventsBridge.init().catch((err: any) => {
        logService.warn(`indexEventsBridge init failed: ${err}`);
      });
      browserEventsBridge.init().catch((err: any) => {
        logService.warn(`browserEventsBridge init failed: ${err}`);
      });
      fsWatcherBridge.init().catch((err: any) => {
        logService.warn(`fsWatcherBridge init failed: ${err}`);
      });
      trayClickBridge.init().catch((err: any) => {
        logService.warn(`trayClickBridge init failed: ${err}`);
      });
      // Extension state push + RPC reply bridges. Must be ready before
      // any `dispatch()` can race the first `state:set` or `request()`.
      stateChangedBridge.init().catch((err: any) => {
        logService.warn(`stateChangedBridge init failed: ${err}`);
      });
      rpcReplyBridge.init().catch((err: any) => {
        logService.warn(`rpcReplyBridge init failed: ${err}`);
      });

      // Tier 2 iframe lifecycle listeners. Awaited so the IPC subscriptions
      // are committed before `restoreWorkers()` below fires EVENT_MOUNT.
      await viewRegistry.init();
      await workerRegistry.init();
      await iframeDeliveryListener.init();
      extensionReadinessListener.init();

      await extensionManager.init(); // Initialize ExtensionManager first

      // Must run after the workerRegistry/viewRegistry listeners above are
      // committed — EVENT_MOUNT is fire-and-forget and would otherwise be lost.
      // Failure here means every always-on extension is dormant until the
      // user re-enables it, so it surfaces through the diagnostics channel
      // rather than a quiet log.
      restoreWorkers().then((result) => {
        if (result === null) {
          void diagnosticsService.report({
            source: 'frontend',
            kind: 'extension-runtime/restore-workers-failed',
            severity: 'error',
            retryable: false,
            developerDetail: 'restore_workers failed',
          });
        }
      });

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
      const { initAppUpdateStore } = await import('./update/appUpdateStore.svelte')
      await initAppUpdateStore()
      logService.info('App update store initialized.')

      // Check whether to show What's New panel (shown once after each update)
      try {
        const { getVersion } = await import('@tauri-apps/api/app')
        const { appUpdaterShouldShowWhatsNew } = await import('../lib/ipc/applicationCommands')
        const { whatsNewStore } = await import('./update/whatsNewStore.svelte')
        const currentVersion = await getVersion()
        const lastSeen = settingsService.currentSettings.updates?.lastSeenVersion
        if (lastSeen == null) {
          // Fresh install — record silently so next update shows the panel
          await settingsService.updateSettings('updates', { lastSeenVersion: currentVersion })
        } else {
          const shouldShow = await appUpdaterShouldShowWhatsNew(lastSeen, currentVersion)
          if (shouldShow) {
            whatsNewStore.version = currentVersion
          }
        }
        logService.info("What's New check complete.")
      } catch (e) {
        logService.warn(`What's New check failed: ${e}`)
      }

      // Initialize extension deeplink service (asyar://extensions/{extId}/{cmdId})
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

      // Notification action dispatch bridge. Runs on every Tauri instance
      // so clicking a button on an OS notification fires the declared
      // extension command even when the launcher window is hidden.
      const { NotificationActionBridge } = await import('./notification/notificationActionBridge.svelte');
      const notificationActionBridge = new NotificationActionBridge({
        getManifestById: (id) => extensionManager.getManifestById(id),
        isExtensionEnabled: (id) => extensionManager.isExtensionEnabled(id),
        hasCommand: (id) => commandService.commands.has(id),
        executeCommand: (id, args) => commandService.executeCommand(id, args),
      });
      await notificationActionBridge.init();
      logService.info('Notification action bridge initialized.');

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

      listen<{ keyword: string; expansion: string }>('snippet:promote-from-cache', async (event) => {
        const { keyword, expansion } = event.payload;
        snippetStore.add({
          id: crypto.randomUUID(),
          keyword,
          expansion,
          name: `${expansion} (${keyword})`,
          createdAt: Date.now(),
        });
      });

      listen<EmojiFallbackPayload>('emoji-fallback', async (event) => {
        const { handleEmojiFallback } = await import('../built-in-features/ai/inlineEmojiFallback');
        void handleEmojiFallback(event.payload);
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

      // Per-extension onboarding completion: when the extension calls
      // `context.proxies.onboarding.complete()`, Rust marks it onboarded
      // and emits this event. The launcher's TS view-handler interception
      // (in ExtensionLoader.ts) stashed the originally-requested view
      // before redirecting to the onboarding view; this listener drains
      // that stash and navigates back so the user lands where they
      // originally asked. (Tier 2 view-mode commands bypass the Rust
      // dispatch path, so Plan B's Rust re-dispatch doesn't cover them.)
      listen<{ extensionId: string }>('asyar:extension-onboarded', ({ payload }) => {
        const entry = onboardingViewInterception.take(payload.extensionId);
        if (entry) {
          logService.debug(
            `[onboarding] re-navigating ${payload.extensionId} → ${entry.viewPath} after complete()`,
          );
          extensionManager.navigateToView(entry.viewPath);
        }
      }).catch((err) => {
        logService.warn(`Failed to register asyar:extension-onboarded listener: ${err}`);
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
