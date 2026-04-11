import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  INotificationService,
} from "asyar-sdk";

import { evaluateMath } from "./engine/math";
import { evaluateUnitExpression } from "./engine/units";
import { evaluateCurrencyExpression, refreshRates } from "./engine/currency";
import { evaluateDatetime } from "./engine/datetime";
import { convertBase } from "./engine/bases";

const DEFAULT_INTERVAL_HOURS = 6;
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 24;

class CalculatorExtension implements Extension {
  private logService?: ILogService;
  private notificationService?: INotificationService;
  private refreshTimer?: any;
  private currentIntervalHours: number = DEFAULT_INTERVAL_HOURS;

  onUnload: any;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>("LogService");
    this.notificationService = context.getService<INotificationService>("NotificationService");

    // Read refresh interval from the frozen preferences snapshot. When the
    // user edits this in Settings, extensionManager reloads the extension
    // and initialize() runs again with the fresh value.
    const raw = context.preferences.refreshInterval;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      this.currentIntervalHours = Math.max(
        MIN_INTERVAL_HOURS,
        Math.min(MAX_INTERVAL_HOURS, raw)
      );
    }
  }

  async executeCommand(_commandId: string, _args?: Record<string, any>): Promise<any> {
    return;
  }

  async activate(): Promise<void> {
    // Perform initial refresh immediately
    refreshRates();

    // Set up periodic refresh. Changes to the interval arrive via a full
    // extension reload (see extensionManager.handlePreferencesChanged), so
    // no runtime listener is needed here.
    this.startRefreshTimer();
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

    const addResult = async (res: string | null | Promise<string | null>, icon: string, formula: string) => {
      const resolved = await res;
      if (!resolved) return;
      results.push({
        score: 1.0,
        title: resolved,
        subtitle: formula,
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
      addResult(evaluateMath(trimmed), "🧮", trimmed),
      addResult(evaluateUnitExpression(trimmed), "📏", trimmed),
      addResult(evaluateCurrencyExpression(trimmed), "💵", trimmed),
      addResult(evaluateDatetime(trimmed), "📅", trimmed),
      addResult(convertBase(trimmed), "🔟", trimmed)
    ]);


    return results;
  }

}

// Export singleton instance
const extension = new CalculatorExtension();
export default extension;
