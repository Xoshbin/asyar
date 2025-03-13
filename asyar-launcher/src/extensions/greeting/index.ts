import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
} from "asyar-extension-sdk";

class Greeting implements Extension {
  onUnload: any;
  onViewSearch?: ((query: string) => Promise<void>) | undefined;
  id = "greeting";
  name = "Greeting";
  version = "1.0.0";

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    // console.log("Initializing Greeting extension");
    this.logService = context.getService<ILogService>("LogService");
    // this.logService?.info(`${this.name} initialized`);
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
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
    this.logService?.info(`${this.name} deactivated`);
  }
}

// Create and export a single instance
export default new Greeting();
