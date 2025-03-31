import { extensionInstallerState } from "./state";
import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
  INotificationService,
} from "asyar-api";
import type { ExtensionAction, IActionService } from "asyar-api/dist/types";

class ExtensionInstallerExtension implements Extension {
  onUnload: any;
  onViewSearch?: ((query: string) => Promise<void>) | undefined;

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private notificationService?: INotificationService;
  private actionService?: IActionService;
  private inView: boolean = false;
  private context?: ExtensionContext;

  async initialize(context: ExtensionContext): Promise<void> {
    this.context = context;
    this.logService = context.getService<ILogService>("LogService");
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.notificationService = context.getService<INotificationService>(
      "NotificationService"
    );
    this.actionService = context.getService<IActionService>("ActionService");

    // Initialize state with services
    extensionInstallerState.initializeServices(context);

    this.logService?.info("Extension Installer extension initialized");
  }

  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(
      `Executing command ${commandId} with args: ${JSON.stringify(args || {})}`
    );

    switch (commandId) {
      case "show-installer":
        this.extensionManager?.navigateToView(
          "extension-installer/ExtensionInstallerView"
        );
        return {
          type: "view",
          viewPath: "extension-installer/ExtensionInstallerView",
        };

      case "install-from-url":
        if (args?.url) {
          const result = await extensionInstallerState.installExtension(
            args.url
          );
          return { success: result.success, message: result.message };
        }
        return { success: false, message: "No URL provided" };

      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  // Called when this extension's view is activated
  viewActivated(viewPath: string) {
    this.inView = true;

    if (this.actionService) {
      const clearFormAction: ExtensionAction = {
        id: "extension-installer-clear-form",
        title: "Clear Form",
        description: "Clear the extension installer form",
        icon: "🔄",
        extensionId: "extension-installer",
        category: "extension-installer",
        execute: () => {
          extensionInstallerState.reset();
          this.logService?.info("Extension installer form reset");
        },
      };

      const refreshExtensionsAction: ExtensionAction = {
        id: "extension-installer-refresh",
        title: "Refresh Extensions",
        description: "Reload all extensions",
        icon: "🔄",
        extensionId: "extension-installer",
        category: "extension-installer",
        execute: async () => {
          try {
            await this.extensionManager?.refreshExtensions();
            this.notificationService?.notify({
              title: "Extensions Refreshed",
              body: "All extensions have been reloaded",
            });
            this.logService?.info("Extensions refreshed");
          } catch (error) {
            this.logService?.error(`Failed to refresh extensions: ${error}`);
          }
        },
      };

      this.actionService.registerAction(clearFormAction);
      this.actionService.registerAction(refreshExtensionsAction);
      this.logService?.debug(
        "Extension installer view-specific actions registered"
      );
    }
  }

  // Called when this extension's view is deactivated
  viewDeactivated() {
    if (this.inView && this.actionService) {
      this.actionService.unregisterAction("extension-installer-clear-form");
      this.actionService.unregisterAction("extension-installer-refresh");
      this.logService?.debug(
        "Extension installer view-specific actions unregistered"
      );
    }
    this.inView = false;
  }

  async activate(): Promise<void> {
    this.logService?.info("Extension Installer extension activated");
  }

  async deactivate(): Promise<void> {
    if (this.actionService && this.inView) {
      this.actionService.unregisterAction("extension-installer-clear-form");
      this.actionService.unregisterAction("extension-installer-refresh");
    }
    this.logService?.info("Extension Installer extension deactivated");
  }
}

// Create and export a single instance
export default new ExtensionInstallerExtension();
