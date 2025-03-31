import { logService } from './log/logService';
import { performanceService } from './performance/performanceService';
import { ClipboardHistoryService } from './clipboard/clipboardHistoryService';
import { applicationService } from './application/applicationsService';
import extensionManager from './extension/extensionManager'; // Assuming default export
import { searchQuery } from './search/stores/search'; // Import searchQuery store
import { get } from 'svelte/store'; // Import get to read store value

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

      // Initialize performance service first
      await performanceService.init();
      logService.custom("🔍 Performance monitoring initialized", "PERF", "cyan", "cyan");
      performanceService.logPerformanceReport(); // Initial report

      // Initialize Clipboard History
      const clipboardHistoryService = ClipboardHistoryService.getInstance();
      await clipboardHistoryService.initialize();
      logService.info(`Clipboard history service initialized.`);

      // Start overall app and specific service timing
      performanceService.startTiming("app-initialization");
      performanceService.startTiming("service-init");

      // Initialize core services
      await applicationService.init();
      await extensionManager.init(); // This now handles its own performance logging

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
