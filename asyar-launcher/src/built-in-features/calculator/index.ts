import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  INotificationService,
  ISettingsService
} from "asyar-sdk";

import { evaluateMath } from "./engine/math";
import { evaluateUnitExpression } from "./engine/units";
import { evaluateCurrencyExpression, refreshRates } from "./engine/currency";
import { evaluateDatetime } from "./engine/datetime";
import { convertBase } from "./engine/bases";

class CalculatorExtension implements Extension {
  private logService?: ILogService;
  private notificationService?: INotificationService;
  private settingsService?: ISettingsService;
  private refreshTimer?: any;
  private currentIntervalHours: number = 6;

  onUnload: any;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>("LogService");
    this.notificationService = context.getService<INotificationService>("NotificationService");
    this.settingsService = context.getService<ISettingsService>("SettingsService");

    // Initial fetch of refresh interval
    try {
      const interval = await this.settingsService.get<number>("calculator", "refreshInterval");
      if (interval) {
        this.currentIntervalHours = interval;
      }
    } catch (e) {
      this.logService?.warn("Failed to load refresh interval setting, using default (6h)");
    }
  }

  async executeCommand(_commandId: string, _args?: Record<string, any>): Promise<any> {
    return;
  }

  async activate(): Promise<void> {
    // Perform initial refresh immediately
    refreshRates();

    // Set up periodic refresh
    this.startRefreshTimer();

    // Listen for settings changes
    if (this.settingsService) {
      this.settingsService.onChanged<{ refreshInterval: number }>("calculator", (settings: { refreshInterval: number }) => {
        if (settings && settings.refreshInterval !== this.currentIntervalHours) {
          this.logService?.info(`Refresh interval changed to ${settings.refreshInterval}h`);
          this.currentIntervalHours = settings.refreshInterval;
          this.startRefreshTimer();
        }
      });
    }
  }
  
  private startRefreshTimer() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    const intervalMs = this.currentIntervalHours * 60 * 60 * 1000;
    this.refreshTimer = setInterval(() => {
      this.logService?.info("Background currency refresh triggered");
      refreshRates();
    }, intervalMs);
  }

  async deactivate(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  async search(query: string): Promise<ExtensionResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const results: ExtensionResult[] = [];

    const addResult = async (res: string | null | Promise<string | null>, icon: string, subtitleHint: string) => {
      const resolved = await res;
      if (!resolved) return;
      results.push({
        score: 1.0,
        title: resolved,
        subtitle: subtitleHint,
        type: "result",
        icon: icon,
        style: "large",
        action: async () => {
          try {
            await navigator.clipboard.writeText(resolved);
            this.notificationService?.notify({
              title: "Calculator",
              body: `Copied: ${resolved}`
            });
          } catch (e) {
            this.logService?.error("Copy failed: " + e);
          }
        }
      });
    };

    // Calculate possible results based on expressions
    await Promise.all([
      addResult(evaluateMath(trimmed), "🧮", "Calculator"),
      addResult(evaluateUnitExpression(trimmed), "📏", "Unit Conversion"),
      addResult(evaluateCurrencyExpression(trimmed), "💵", "Currency Conversion"),
      addResult(evaluateDatetime(trimmed), "📅", "Date/Time"),
      addResult(convertBase(trimmed), "🔟", "Number Base")
    ]);


    return results;
  }

}

// Export a singleton instance and the default view component as explicitly required by system
const extension = new CalculatorExtension();
export default extension;
