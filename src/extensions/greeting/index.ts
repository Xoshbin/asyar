import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
  IClipboardHistoryService,
  INotificationService,
} from "asyar-api";
import { ClipboardItemType } from "asyar-api";
import type { ExtensionAction, IActionService } from "asyar-api";
import { commandService } from "../../services/extension/commandService";

class Greeting implements Extension {
  onUnload: any;
  onViewSearch?: ((query: string) => Promise<void>) | undefined;

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private actionService?: IActionService;
  private clipboardService?: IClipboardHistoryService;
  private notificationService?: INotificationService;
  private inView: boolean = false;
  private context?: ExtensionContext; // Keep context reference

  async initialize(context: ExtensionContext): Promise<void> {
    this.context = context;
    this.logService = context.getService<ILogService>("LogService");
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.actionService = context.getService<IActionService>("ActionService");
    // Get additional services
    this.clipboardService = context.getService<IClipboardHistoryService>(
      "ClipboardHistoryService"
    );
    this.notificationService = context.getService<INotificationService>(
      "NotificationService"
    );

    this.logService?.info(
      "Greeting extension initialized with clipboard and notification services"
    );
  }

  // Updated method to execute commands - this now handles all commands defined in the manifest
  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(
      `Executing command ${commandId} with args: ${JSON.stringify(args || {})}`
    );

    switch (commandId) {
      case "show-form":
        this.extensionManager?.navigateToView("greeting/GreetingView");
        // Register action when command is executed
        this.registerViewActions();
        return {
          type: "view",
          viewPath: "greeting/GreetingView",
        };

      case "greet-copy-argument":
        const textToCopy = args?.textToCopy;
        if (textToCopy && this.clipboardService) {
          try {
            await this.clipboardService.writeToClipboard({
              id: `greeting-${Date.now()}`, // Simple unique ID
              type: ClipboardItemType.Text,
              content: textToCopy,
              preview: textToCopy,
              createdAt: Date.now(),
              favorite: false,
            });
            // Use notify method
            this.notificationService?.notify({
              title: "Greeting Copied!",
              body: `"${textToCopy}" copied to clipboard.`,
            });
            this.logService?.info(`Copied greeting: ${textToCopy}`);
            // Optionally close the main window if needed
            // this.extensionManager?.closeView();
            return { success: true };
          } catch (error) {
            this.logService?.error(`Failed to copy greeting: ${error}`);
            // Use notify method
            this.notificationService?.notify({
              title: "Copy Failed",
              body: "Could not copy greeting to clipboard.",
              // level: "error", // Removed invalid property
            });
            return { success: false, error: error };
          }
        } else {
          this.logService?.warn(
            `greet-copy-argument called without textToCopy or clipboardService unavailable.`
          );
          return { success: false, error: "Missing text or service" };
        }

      default:
        this.logService?.error(`Received unknown command ID: ${commandId}`);
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  // Implement search for dynamic results
  async search(query: string): Promise<ExtensionResult[]> {
    const lowerQuery = query.toLowerCase();
    this.logService?.debug(`Greeting search received query: "${query}"`);

    // Handle "hey [name]" pattern
    if (lowerQuery.startsWith("hey ")) {
      this.logService?.debug(`Query starts with "hey ": "${query}"`);
      const name = query.substring(4).trim(); // Get the part after "hey "
      if (name) {
        this.logService?.debug(`Extracted name: "${name}"`);
        // Only proceed if there's a name
        const dynamicGreetingString = `hey ${name} 👋`;
        const fullCommandId = "cmd_greeting_greet-copy-argument"; // Construct the full command ID

        return [
          {
            title: dynamicGreetingString,
            subtitle: "Press Enter to copy",
            type: "result",
            action: async () => {
              // Use imported commandService
              if (commandService) {
                try {
                  await commandService.executeCommand(fullCommandId, {
                    textToCopy: dynamicGreetingString,
                  });
                } catch (error) {
                  this.logService?.error(
                    `Failed to execute command ${fullCommandId}: ${error}`
                  ); // Added comma
                }
              } else {
                this.logService?.error(
                  "Global commandService not available for dynamic greeting action."
                );
              }
            },
            score: 1, // High score to prioritize this result
          },
        ];
      } else {
        this.logService?.debug(`No name found after "hey "`);
        return []; // Explicitly return empty if no name after "hey "
      }
    }
    // Use 'else if' for mutual exclusion
    else if (lowerQuery === "greet") {
      this.logService?.debug(`Query matches "greet"`);
      return [
        {
          title: "Show Greeting Form",
          subtitle: "Open the interactive greeting form",
          type: "view", // Keep as view type
          action: async () => {
            // Execute the original command to navigate using imported commandService
            if (commandService) {
              try {
                await commandService.executeCommand("cmd_greeting_show-form");
              } catch (error) {
                this.logService?.error(
                  `Failed to execute command cmd_greeting_show-form: ${error}`
                ); // Added comma
              }
            }
          },
          score: 0.8, // Slightly lower score than dynamic result
        },
      ];
    }
    // Removed extra closing brace here

    // No match
    this.logService?.debug(
      `Query "${query}" did not match any greeting patterns.`
    );
    return [];
  }

  // Called when this extension's view is activated - Make async
  async viewActivated(viewPath: string): Promise<void> {
    this.inView = true;
    // Actions are now registered when the command is executed.
    this.logService?.debug(`Greeting view activated: ${viewPath}`);
  }

  // Helper method to register view-specific actions
  private registerViewActions() {
    if (!this.actionService) {
      this.logService?.warn(
        "ActionService not available, cannot register view actions."
      );
      return;
    }
    this.logService?.debug("Registering greeting view actions...");

    const clearFormAction: ExtensionAction = {
      id: "greeting-clear-form",
      title: "Reset Greeting Form",
      description: "Clear your name and greeting",
      icon: "🔄",
      extensionId: "greeting",
      category: "view-action", // Context is implicitly EXTENSION_VIEW
      execute: () => {
        // We'll handle this event in the view component
        document.dispatchEvent(new CustomEvent("greeting-reset-form"));
        this.logService?.info("Greeting form reset requested");
      },
    };
    this.actionService.registerAction(clearFormAction);
  }

  // Helper method to unregister view-specific actions
  private unregisterViewActions() {
    if (!this.actionService) {
      this.logService?.warn(
        "ActionService not available, cannot unregister view actions."
      );
      return;
    }
    this.logService?.debug("Unregistering greeting view actions...");
    this.actionService.unregisterAction("greeting-clear-form");
  }

  // Called when this extension's view is deactivated - Make async and add parameter
  async viewDeactivated(viewPath: string): Promise<void> {
    // Unregister actions when the view is deactivated
    this.unregisterViewActions();
    this.inView = false;
    this.logService?.debug(`Greeting view deactivated: ${viewPath}`);
  }

  async activate(): Promise<void> {
    this.logService?.info("Greeting extension activated");
  }

  async deactivate(): Promise<void> {
    // Ensure actions are unregistered if the extension is deactivated while view is active
    if (this.inView) {
      this.unregisterViewActions();
    }
    this.logService?.info("Greeting extension deactivated");
  }
}

// Create and export a single instance
export default new Greeting();
