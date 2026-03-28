import { logService } from './log/logService';
import { performanceService } from './performance/performanceService';
import { ClipboardHistoryService } from './clipboard/clipboardHistoryService';
import { applicationService } from './application/applicationsService';
import extensionManager from './extension/extensionManager';
import { commandService } from './extension/commandService'; // Import commandService instance
import { searchStores } from './search/stores/search.svelte'; // Import searchStores
import { get } from 'svelte/store'; // Import get to read store value
import { envService } from './envService';
import { browserShimService } from './browserShimService';
import { type Event, listen } from '@tauri-apps/api/event';
import * as commands from '../lib/ipc/commands';
import { shortcutService } from '../built-in-features/shortcuts/shortcutService';
import { shortcutStore } from '../built-in-features/shortcuts/shortcutStore.svelte';
import { snippetStore } from '../built-in-features/snippets/snippetStore.svelte';
import { snippetService } from '../built-in-features/snippets/snippetService';
import { portalStore } from '../built-in-features/portals/portalStore.svelte';

// Flag to prevent multiple initializations
let isInitialized = false;

export const appInitializer = {
  async init(): Promise<boolean> {
    if (isInitialized) {
      logService.warn("Application already initialized.");
      return true;
    }

    try {
      logService.info(`Application starting initialization...`);

      // Initialize browser shims for non-Tauri environments
      browserShimService.init();

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

      await extensionManager.init(); // Initialize ExtensionManager first
      commandService.initialize(extensionManager); // Initialize CommandService with ExtensionManager instance

      if (envService.isTauri) {
        await shortcutStore.init();
        await snippetStore.init();
        await portalStore.init();
        await shortcutService.init();
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

        // Listen for tray item clicks
        listen<string>('tray-item-clicked', async (event) => {
          const compositeId = event.payload;
          logService.info(`Tray item clicked: ${compositeId}`);
          
          const [extensionId, itemId] = compositeId.split(':');
          if (!extensionId || !itemId) return;

          try {
            await commands.showWindow();
            
            // Use default view for the extension mapped to the clicked item
            const manifest = extensionManager.getManifestById?.(extensionId);
            if (manifest && manifest.defaultView) {
              await extensionManager.navigateToView(`${extensionId}/${manifest.defaultView}`);
            } else {
              logService.warn(`No default view found for extension ${extensionId}`);
            }
          } catch (error) {
            logService.error(`Failed to navigate to extension ${extensionId} from tray: ${error}`);
          }
        });
      }

      const serviceInitMetrics = performanceService.stopTiming("service-init");
      logService.custom(`🔌 Core services initialized in ${serviceInitMetrics.duration?.toFixed(2)}ms`, "PERF", "green");

      isInitialized = true; // Set initialized flag

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
