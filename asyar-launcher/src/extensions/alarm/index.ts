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

class Alarm implements Extension {
  onUnload: any;
  searchProviders?: SearchProvider[] | undefined;
  id = "alarm";
  name = "Alarm";
  version = "1.0.0";

  private logService?: ILogService;
  private notificationService?: INotificationService;
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    console.log("Initializing Alarm extension");
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.logService = context.getService<ILogService>("LogService");
    this.notificationService = context.getService<INotificationService>(
      "NotificationService"
    );
    this.logService?.info(`${this.name} initialized`);
  }

  async search(query: string): Promise<ExtensionResult[]> {
    // Match queries like "alarm 5m" or "timer 30s"
    const timerMatch = query.match(
      /^(alarm|timer)\s+(\d+)([smh])(?:\s+(.+))?$/i
    );

    if (timerMatch) {
      const amount = parseInt(timerMatch[2]);
      const unit = timerMatch[3].toLowerCase();
      const message = timerMatch[4] || "Timer finished!";

      let seconds = amount;
      if (unit === "m") seconds = amount * 60;
      if (unit === "h") seconds = amount * 60 * 60;

      const readableTime = formatTime(seconds);

      return [
        {
          title: `Set ${readableTime} timer: ${message}`,
          subtitle: "Press Enter to start timer rignht now",
          type: "result",
          action: async () => {
            await createTimer(
              seconds,
              message,
              this.notificationService,
              this.logService
            );
            // this.extensionManager?.window.hide();
          },
          score: 0,
        },
      ];
    }

    // For simple "alarm" query, show the view
    if (
      query.toLowerCase().startsWith("alarm") ||
      query.toLowerCase().startsWith("timer")
    ) {
      return [
        {
          title: "Alarm & Timer new",
          subtitle: "View and set alarms and timers",
          type: "view",
          action: async () => {
            await this.extensionManager?.navigateToView("alarm/AlarmView");
          },
          score: 0,
        },
      ];
    }

    return [];
  }

  async onViewSearch(query: string) {
    alarmState.setSearch(query);
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
    });
    alarmState.completeTimer(timerId);
  }, seconds * 1000);

  // Show confirmation notification
  await notificationService?.notify({
    body: `${formatTime(seconds)} timer has been started`,
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
export default new Alarm();
