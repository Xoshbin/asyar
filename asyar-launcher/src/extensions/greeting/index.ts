import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
} from "asyar-extension-sdk";
import type {
  ExtensionAction,
  IActionService,
} from "asyar-extension-sdk/dist/types";

class Greeting implements Extension {
  onUnload: any;
  onViewSearch?: ((query: string) => Promise<void>) | undefined;

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private actionService?: IActionService;
  private inView: boolean = false;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>("LogService");
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.actionService = context.getService<IActionService>("ActionService");

    // if (this.actionService) {
    //   // Register a general action for this extension
    //   const greetingAction: ExtensionAction = {
    //     id: "greeting-action",
    //     title: "Quick Greeting",
    //     description: "Open the greeting form",
    //     icon: "👋",
    //     extensionId: this.id,
    //     execute: () => {
    //       this.logService?.info("Executing greeting action");
    //       this.extensionManager?.navigateToView("greeting/GreetingView");
    //     },
    //   };

    //   this.actionService.registerAction(greetingAction);
    //   this.logService?.info("Greeting action registered");
    // }
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
        extensionId: this.id,
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

  async search(query: string): Promise<ExtensionResult[]> {
    // this.logService?.info(`Searching with query: ${query}`);

    if (!query.toLowerCase().includes("greet")) return [];

    return [
      {
        title: "Greeting Form",
        subtitle: "Open greeting form to get a personalized welcome",
        type: "view",
        viewPath: "greeting/GreetingView",
        action: () => {
          // console.log("Opening greeting form view");
          // this.logService?.info("Opening greeting form view");
          this.extensionManager?.navigateToView("greeting/GreetingView");
        },
        score: 1,
      },
    ];
  }

  async activate(): Promise<void> {
    this.logService?.info(`${this.name} activated`);
  }

  async deactivate(): Promise<void> {
    // Unregister actions when extension is deactivated
    if (this.actionService) {
      this.actionService.unregisterAction("greeting-action");

      // Also clean up view-specific actions if they exist
      if (this.inView) {
        this.actionService.unregisterAction("greeting-clear-form");
      }

      this.logService?.info("Greeting actions unregistered");
    }

    this.logService?.info(`${this.name} deactivated`);
  }
}

// Create and export a single instance
export default new Greeting();
