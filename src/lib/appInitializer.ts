import { LogService } from "../services/logService";
import { settingsService } from "../services/settingsService";
import extensionManager from "../services/extensionManager";

/**
 * Handles app initialization in the correct sequence
 */
class AppInitializer {
  /**
   * Initialize all app services in the correct order
   */
  async initializeApp(): Promise<boolean> {
    try {
      // LogService.info("Starting application initialization sequence");

      // Step 1: Initialize settings service first
      // LogService.info("Step 1: Initializing settings service");
      const settingsInitSuccess = await settingsService.init();
      if (!settingsInitSuccess) {
        LogService.error(
          "Settings service initialization failed, continuing with defaults"
        );
        // Continue anyway - we have defaults
      }

      // Step 2: Initialize extension manager after settings
      // LogService.info("Step 2: Initializing extension manager");
      const extensionsInitSuccess = await extensionManager.init();
      if (!extensionsInitSuccess) {
        LogService.error("Extension manager initialization failed");
        // Continue anyway - app can function without extensions
      }

      // Any additional initialization steps can go here

      // LogService.info("Application initialization complete");
      return true;
    } catch (error) {
      LogService.error(`Application initialization failed: ${error}`);
      return false;
    }
  }
}

export const appInitializer = new AppInitializer();
