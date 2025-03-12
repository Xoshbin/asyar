import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  INotificationService,
} from "asyar-extension-sdk";
import type { SearchProvider } from "asyar-extension-sdk/dist/types";

class Greeting implements Extension {
  onUnload: any;
  onViewSearch?: ((query: string) => Promise<void>) | undefined;
  searchProviders?: SearchProvider[] | undefined;
  id = "greeting";
  name = "Greeting";
  version = "1.0.0";

  private logService?: ILogService;
  private notification?: INotificationService;

  async initialize(context: ExtensionContext): Promise<void> {
    console.log("Initializing Greeting extension");
    this.logService = context.getService<ILogService>("LogService");
    this.notification = context.getService<INotificationService>(
      "NotificationService"
    );
    this.notification?.notify({
      body: "hi there from greeting extension",
    });
    this.logService?.info(`${this.name} initialized`);
  }

  async search(query: string): Promise<ExtensionResult[]> {
    this.logService?.info(`Searching with query: ${query}`);

    if (!query.toLowerCase().includes("greet")) return [];

    return [
      {
        title: "Greeting Form",
        subtitle: "Open greeting form to get a personalized welcome",
        type: "view",
        viewPath: "greeting/GreetingView",
        action: () => {
          console.log("Opening greeting form view");
          this.logService?.info("Opening greeting form view");
          this.notification?.notify({
            body: "hi there from greeting extension",
          });
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
