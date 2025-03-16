import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
  INotificationService,
  ExtensionManifest,
} from "asyar-extension-sdk";
import type {
  ExtensionAction,
  IActionService,
} from "asyar-extension-sdk/dist/types";
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

  // Register commands for the alarm extension
  async registerCommands(): Promise<void> {
    if (!this.context) {
      this.logService?.error(
        "Cannot register commands - context is not initialized"
      );
      return;
    }

    // Register the set-timer command - inline result for timer creation
    this.context.registerCommand("set-timer", {
      execute: async (args) => {
        const input = args?.input || "";
        this.logService?.info(`Timer command with input: ${input}`);

        // Pattern to match: "5m Meeting starts" or "30s Check laundry"
        const timerMatch = input.match(/^(\d+)([smh])(?:\s+(.+))?$/i);

        if (timerMatch) {
          const amount = parseInt(timerMatch[1]);
          const unit = timerMatch[2].toLowerCase();
          const message = timerMatch[3] || "Timer finished!";

          let seconds = amount;
          if (unit === "m") seconds = amount * 60;
          if (unit === "h") seconds = amount * 3600;

          try {
            const timerObj = await alarmState.createTimer(seconds, message);
            return {
              type: "inline",
              displayTitle: `Timer set for ${formatTime(seconds)}: ${message}`,
              displaySubtitle: `Will notify at ${new Date(
                timerObj.endsAt
              ).toLocaleTimeString()}`,
              action: "timer-created-action",
              timer: timerObj,
            };
          } catch (error) {
            return {
              type: "inline",
              displayTitle: `Failed to create timer`,
              displaySubtitle: String(error),
              error: String(error),
            };
          }
        } else {
          return {
            type: "inline",
            displayTitle: "Set a Timer",
            displaySubtitle:
              "Format: [number][s|m|h] [message] (e.g., '5m Check pizza', '30s Call back')",
          };
        }
      },
    });

    // Register the show-alarms command - view for managing alarms
    this.context.registerCommand("show-alarms", {
      execute: async () => {
        this.logService?.info("Opening alarms view");
        this.extensionManager?.navigateToView("alarm-extension/AlarmView");
        return {
          type: "view",
          viewPath: "alarm-extension/AlarmView",
        };
      },
    });

    // Register action handlers
    this.context.registerCommand("timer-created-action", {
      execute: async (args) => {
        // This action is executed when a timer result is clicked
        this.logService?.info("Timer result clicked");
        // No additional action needed as the timer is already created
        return { success: true };
      },
    });

    this.logService?.info("Alarm extension commands registered");
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
      case "set-timer":
        const input = args?.input || "";

        // Pattern to match: "5m Meeting starts" or "30s Check laundry"
        const timerMatch = input.match(/^(\d+)([smh])(?:\s+(.+))?$/i);

        if (timerMatch) {
          const amount = parseInt(timerMatch[1]);
          const unit = timerMatch[2].toLowerCase();
          const message = timerMatch[3] || "Timer finished!";

          let seconds = amount;
          if (unit === "m") seconds = amount * 60;
          if (unit === "h") seconds = amount * 3600;

          try {
            const timerObj = await alarmState.createTimer(seconds, message);
            return {
              type: "inline",
              displayTitle: `Timer set for ${formatTime(seconds)}: ${message}`,
              displaySubtitle: `Will notify at ${new Date(
                timerObj.endsAt
              ).toLocaleTimeString()}`,
              timer: timerObj,
            };
          } catch (error) {
            return {
              type: "inline",
              displayTitle: `Failed to create timer`,
              displaySubtitle: String(error),
              error: String(error),
            };
          }
        } else {
          return {
            type: "inline",
            displayTitle: "Set a Timer",
            displaySubtitle:
              "Format: [number][s|m|h] [message] (e.g., '5m Check pizza', '30s Call back')",
          };
        }

      case "show-alarms":
        this.extensionManager?.navigateToView("alarm-extension/AlarmView");
        return {
          type: "view",
          viewPath: "alarm-extension/AlarmView",
        };

      case "timer-created-action":
        // No additional action needed as the timer is already created
        return { success: true };

      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  // Called when this extension's view is activated
  viewActivated(viewPath: string) {
    this.inView = true;

    if (this.actionService) {
      // Register action to clear all active timers
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
              // Get current timers and delete each one
              const currentState = alarmState.getCurrentState();
              const activeTimers = currentState.timers.filter(
                (timer) => timer.active
              );

              if (activeTimers.length === 0) {
                alert("No active timers to clear.");
                return;
              }

              // Delete each timer
              activeTimers.forEach((timer) => {
                alarmState.deleteTimer(timer.id);
              });

              this.logService?.info(`Cleared ${activeTimers.length} timers`);
            }
          } catch (error) {
            this.logService?.error(`Failed to clear timers: ${error}`);
          }
        },
      };

      // Quick timer actions
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
          } catch (error) {
            this.logService?.error(`Failed to start timer: ${error}`);
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
          } catch (error) {
            this.logService?.error(`Failed to start timer: ${error}`);
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
          } catch (error) {
            this.logService?.error(`Failed to start timer: ${error}`);
          }
        },
      };

      // Register the actions
      this.actionService.registerAction(clearAllTimersAction);
      this.actionService.registerAction(quickTimer1Min);
      this.actionService.registerAction(quickTimer5Min);
      this.actionService.registerAction(quickTimer15Min);

      this.logService?.debug(
        "Alarm extension view-specific actions registered"
      );
    }
  }

  // Called when this extension's view is deactivated
  viewDeactivated() {
    // Remove view-specific actions when leaving the view
    if (this.inView && this.actionService) {
      this.actionService.unregisterAction("alarm-clear-all-timers");
      this.actionService.unregisterAction("alarm-quick-timer-1min");
      this.actionService.unregisterAction("alarm-quick-timer-5min");
      this.actionService.unregisterAction("alarm-quick-timer-15min");
      this.logService?.debug(
        "Alarm extension view-specific actions unregistered"
      );
    }
    this.inView = false;
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
    // Clean up any registered actions if needed
    if (this.actionService && this.inView) {
      this.actionService.unregisterAction("alarm-clear-all-timers");
      this.actionService.unregisterAction("alarm-quick-timer-1min");
      this.actionService.unregisterAction("alarm-quick-timer-5min");
      this.actionService.unregisterAction("alarm-quick-timer-15min");
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
