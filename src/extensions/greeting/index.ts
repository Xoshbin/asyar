import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
} from "asyar-api";
import type { ExtensionAction, IActionService } from "asyar-api";

class Greeting implements Extension {
  onUnload: any;
  onViewSearch?: ((query: string) => Promise<void>) | undefined;

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private actionService?: IActionService;
  private inView: boolean = false;
  private context?: ExtensionContext;

  async initialize(context: ExtensionContext): Promise<void> {
    this.context = context;
    this.logService = context.getService<ILogService>("LogService");
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.actionService = context.getService<IActionService>("ActionService");

    this.logService?.info("Greeting extension initialized");
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
        return {
          type: "view",
          viewPath: "greeting/GreetingView",
        };

      case "greet-user":
        // Extract name directly from input argument, which contains what follows after "hey"
        const input = args?.input || "";
        this.logService?.info(`Raw greeting input: "${input}"`);

        // Use input as name, fallback to "friend" only if nothing was provided
        const name = input.trim() || "friend";
        this.logService?.info(`Using name for greeting: "${name}"`);

        const emojis = ["👋", "😊", "🎉", "✨", "🌟", "👍", "🙌"];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

        // Return a formatted greeting with emoji and standard display properties
        return {
          type: "inline",
          displayTitle: `${randomEmoji} Hello, ${name}! Nice to meet you! ${randomEmoji}`,
          displaySubtitle: `Greeting generated at ${new Date().toLocaleTimeString()}`,
          greeting: `${randomEmoji} Hello, ${name}! Nice to meet you! ${randomEmoji}`,
          timestamp: new Date().toISOString(),
        };

      case "greet-user-action":
        // Handle the result click action (called by ExtensionManager)
        this.logService?.info("User clicked on greeting result");
        return { success: true };

      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  // Called when this extension's view is activated
  viewActivated(viewPath: string) {
    this.inView = true;

    // Add a context-specific action for when we're in the greeting view
    if (this.actionService) {
      const clearFormAction: ExtensionAction = {
        id: "greeting-clear-form",
        title: "Reset Greeting Form",
        description: "Clear your name and greeting",
        icon: "🔄",
        extensionId: "greeting",
        category: "view-action",
        execute: () => {
          // We'll handle this event in the view component
          document.dispatchEvent(new CustomEvent("greeting-reset-form"));
          this.logService?.info("Greeting form reset requested");
        },
      };

      this.actionService.registerAction(clearFormAction);
      this.logService?.debug("Greeting view-specific actions registered");
    }
  }

  // Called when this extension's view is deactivated
  viewDeactivated() {
    // Remove view-specific actions when leaving the view
    if (this.inView && this.actionService) {
      this.actionService.unregisterAction("greeting-clear-form");
      this.logService?.debug("Greeting view-specific actions unregistered");
    }
    this.inView = false;
  }

  async activate(): Promise<void> {
    this.logService?.info("Greeting extension activated");
  }

  async deactivate(): Promise<void> {
    // Unregister actions when extension is deactivated
    if (this.actionService) {
      // Clean up view-specific actions if they exist
      if (this.inView) {
        this.actionService.unregisterAction("greeting-clear-form");
      }
      this.logService?.info("Greeting actions unregistered");
    }

    this.logService?.info("Greeting extension deactivated");
  }
}

// Create and export a single instance
export default new Greeting();
