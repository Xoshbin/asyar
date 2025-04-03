import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
  INotificationService,
  ExtensionManifest,
} from "asyar-api";
import type { ExtensionAction, IActionService } from "asyar-api/dist/types";
import { alarmState } from "./state";

class AlarmExtension implements Extension {
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
    this.logService?.info(`Alarm extension initialized`);

    // Initialize state services
    alarmState.initializeServices(context);
  }

  // Execute commands
  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(
      `Executing command ${commandId} with args: ${JSON.stringify(args || {})}`
    );

    switch (commandId) {
      case "show-alarms":
        this.extensionManager?.navigateToView("alarm-extension/AlarmView");
        // Register actions when the command leading to the view is executed
        this.registerViewActions();
        return {
          type: "view",
          viewPath: "alarm-extension/AlarmView",
        };

      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  // Called when this extension's view is activated
  async viewActivated(viewPath: string): Promise<void> {
    // Make async
    this.inView = true;
    // Actions are now registered when the command is executed.
    // We might still need logic here if the view state needs refreshing.
    this.logService?.debug(`Alarm view activated: ${viewPath}`);
  }

  // Helper method to register view-specific actions
  private registerViewActions() {
    if (!this.actionService) {
      this.logService?.warn(
        "ActionService not available, cannot register view actions."
      );
      return;
    }
    this.logService?.debug("Registering alarm view actions...");

    // Define actions (same as before)
    const clearAllTimersAction: ExtensionAction = {
      id: "alarm-clear-all-timers",
      title: "Clear All Timers",
      description: "Remove all active timers",
      icon: "🗑️",
      extensionId: "alarm-extension",
      category: "timer-action",
      execute: async () => {
        try {
          if (confirm("Are you sure you want to clear all active timers?")) {
            const currentState = alarmState.getCurrentState();
            const activeTimers = currentState.timers.filter(
              (timer) => timer.active
            );
            if (activeTimers.length === 0) {
              // Add a body to the notification
              this.notificationService?.notify({
                title: "No Active Timers",
                body: "There are no active timers to clear.",
              });
              return;
            }
            activeTimers.forEach((timer) => {
              alarmState.deleteTimer(timer.id);
            });
            this.logService?.info(`Cleared ${activeTimers.length} timers`);
            this.notificationService?.notify({
              title: "Timers Cleared",
              body: `Removed ${activeTimers.length} active timers.`,
            });
          }
        } catch (error) {
          this.logService?.error(`Failed to clear timers: ${error}`);
          this.notificationService?.notify({
            title: "Error",
            body: "Failed to clear timers.",
          });
        }
      },
    };
    const quickTimer1Min: ExtensionAction = {
      id: "alarm-quick-timer-1min",
      title: "1 Minute Timer",
      description: "Start a quick 1 minute timer",
      icon: "⏱️",
      extensionId: "alarm-extension",
      category: "quick-timer",
      execute: async () => {
        try {
          await alarmState.createTimer(60, "1 Minute Timer");
          this.logService?.info("Started 1 minute timer");
          this.notificationService?.notify({
            title: "Timer Started",
            body: "1 minute timer running.",
          });
        } catch (error) {
          this.logService?.error(`Failed to start 1 min timer: ${error}`);
          this.notificationService?.notify({
            title: "Error",
            body: "Failed to start 1 min timer.",
          });
        }
      },
    };
    const quickTimer5Min: ExtensionAction = {
      id: "alarm-quick-timer-5min",
      title: "5 Minute Timer",
      description: "Start a quick 5 minute timer",
      icon: "⏱️",
      extensionId: "alarm-extension",
      category: "quick-timer",
      execute: async () => {
        try {
          await alarmState.createTimer(300, "5 Minute Timer");
          this.logService?.info("Started 5 minute timer");
          this.notificationService?.notify({
            title: "Timer Started",
            body: "5 minute timer running.",
          });
        } catch (error) {
          this.logService?.error(`Failed to start 5 min timer: ${error}`);
          this.notificationService?.notify({
            title: "Error",
            body: "Failed to start 5 min timer.",
          });
        }
      },
    };
    const quickTimer15Min: ExtensionAction = {
      id: "alarm-quick-timer-15min",
      title: "15 Minute Timer",
      description: "Start a quick 15 minute timer",
      icon: "⏱️",
      extensionId: "alarm-extension",
      category: "quick-timer",
      execute: async () => {
        try {
          await alarmState.createTimer(900, "15 Minute Timer");
          this.logService?.info("Started 15 minute timer");
          this.notificationService?.notify({
            title: "Timer Started",
            body: "15 minute timer running.",
          });
        } catch (error) {
          this.logService?.error(`Failed to start 15 min timer: ${error}`);
          this.notificationService?.notify({
            title: "Error",
            body: "Failed to start 15 min timer.",
          });
        }
      },
    };

    // Register the actions
    this.actionService.registerAction(clearAllTimersAction);
    this.actionService.registerAction(quickTimer1Min);
    this.actionService.registerAction(quickTimer5Min);
    this.actionService.registerAction(quickTimer15Min);
  }

  // Helper method to unregister view-specific actions
  private unregisterViewActions() {
    if (!this.actionService) {
      this.logService?.warn(
        "ActionService not available, cannot unregister view actions."
      );
      return;
    }
    this.logService?.debug("Unregistering alarm view actions...");
    this.actionService.unregisterAction("alarm-clear-all-timers");
    this.actionService.unregisterAction("alarm-quick-timer-1min");
    this.actionService.unregisterAction("alarm-quick-timer-5min");
    this.actionService.unregisterAction("alarm-quick-timer-15min");
  }

  // Called when this extension's view is deactivated
  async viewDeactivated(viewPath: string): Promise<void> {
    // Make async
    // Unregister actions when the view is deactivated
    this.unregisterViewActions();
    this.inView = false;
    this.logService?.debug(`Alarm view deactivated: ${viewPath}`);
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
    this.logService?.info("Alarm extension activated");
  }

  async deactivate(): Promise<void> {
    // Ensure actions are unregistered if the extension is deactivated while view is active
    if (this.inView) {
      this.unregisterViewActions();
    }
    this.logService?.info("Alarm extension deactivated");
  }
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
