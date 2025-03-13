import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
  INotificationService,
} from "asyar-extension-sdk";
import type { SearchProvider } from "asyar-extension-sdk/dist/types";
import { alarmState } from "./state";

class AlarmExtension implements Extension {
  onUnload: any;
  onViewSearch?: ((query: string) => Promise<void>) | undefined;
  searchProviders?: SearchProvider[] | undefined;
  id = "alarm-extension";
  name = "AlarmExtension";
  version = "1.0.0";

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private notificationService?: INotificationService;

  async initialize(context: ExtensionContext): Promise<void> {
    // console.log("Initializing AlarmExtension extension");
    this.logService = context.getService<ILogService>("LogService");
    // this.logService?.info(`${this.name} initialized`);
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.notificationService = context.getService<INotificationService>(
      "NotificationService"
    );
    this.logService?.info(`${this.name} initialized inside extension xxxxxxxx`);

    // Initialize state services
    alarmState.initializeServices(context);
  }

  async search(query: string): Promise<ExtensionResult[]> {
    this.logService?.debug(`Searching with query: ${query}`);

    // Pattern to match: "timer 5m Meeting starts" or "alarm 30s hello"
    const timerMatch = query.match(
      /^(timer|alarm)\s+(\d+)([smh])(?:\s+(.+))?$/i
    );

    if (timerMatch) {
      const amount = parseInt(timerMatch[2]);
      const unit = timerMatch[3].toLowerCase();
      const message = timerMatch[4] || "Timer finished!";

      let seconds = amount;
      if (unit === "m") seconds = amount * 60;
      if (unit === "h") seconds = amount * 3600;

      const readableTime = formatTime(seconds);

      return [
        {
          title: `Set ${readableTime} timer: ${message}`,
          subtitle: "Press Enter to start timer",
          type: "result",
          action: async () => {
            this.logService?.info(`Creating timer: ${seconds}s - ${message}`);
            await alarmState.createTimer(seconds, message);
            this.extensionManager?.closeView();
          },
          score: 1,
        },
      ];
    }

    // Show view command only for "alarm" or empty queries
    if (
      query.toLowerCase().startsWith("alarm") ||
      query.toLowerCase().startsWith("timer")
    ) {
      return [
        {
          title: "Alarm & Timer",
          subtitle: "View and manage your timers",
          type: "view",
          viewPath: "alarm-extension/AlarmView",
          action: () =>
            this.extensionManager?.navigateToView("alarm-extension/AlarmView"),
          score: 0,
        },
      ];
    }

    return [];
  }

  async activate(): Promise<void> {
    this.logService?.info(`${this.name} activated`);
  }

  async deactivate(): Promise<void> {
    this.logService?.info(`${this.name} deactivated`);
  }
}

async function createTimer(
  seconds: number,
  message: string,
  notificationService: INotificationService | undefined,
  logService: ILogService | undefined
) {
  // Request notification permission if needed
  let permissionGranted = await notificationService?.checkPermission();
  if (!permissionGranted) {
    permissionGranted = await notificationService?.requestPermission();
    if (!permissionGranted) {
      logService?.error("Notification permission denied");
      return;
    }
  }

  const timerId = Date.now().toString();
  const timerObj = {
    id: timerId,
    duration: seconds,
    message: message,
    createdAt: Date.now(),
    endsAt: Date.now() + seconds * 1000,
    active: true,
  };

  // Add to state
  alarmState.addTimer(timerObj);

  // Set timeout for notification
  setTimeout(async () => {
    await notificationService?.notify({
      body: message,
      title: message,
    });
    alarmState.completeTimer(timerId);
  }, seconds * 1000);

  // Show confirmation notification
  await notificationService?.notify({
    body: `${formatTime(seconds)} timer has been started`,
    title: message,
  });

  return timerObj;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} hour${hours !== 1 ? "s" : ""}${
    minutes > 0 ? ` ${minutes} minute${minutes !== 1 ? "s" : ""}` : ""
  }`;
}

// Create and export a single instance
export default new AlarmExtension();
