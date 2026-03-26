import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  INotificationService
} from "asyar-sdk";
import type { ExtensionAction } from "asyar-sdk/dist/types";
import { actionService } from "../../services/action/actionService";

import { lastCalculatorQuery } from "./state";
import DefaultView from "./DefaultView.svelte";

import { evaluateMath } from "./engine/math";
import { evaluateUnitExpression } from "./engine/units";
import { evaluateCurrencyExpression } from "./engine/currency";
import { evaluateDatetime } from "./engine/datetime";
import { convertBase } from "./engine/bases";

class CalculatorExtension implements Extension {
  private logService?: ILogService;
  private notificationService?: INotificationService;
  private inView: boolean = false;

  onUnload: any;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>("LogService");
    this.notificationService = context.getService<INotificationService>("NotificationService");
  }

  async executeCommand(_commandId: string, _args?: Record<string, any>): Promise<any> {
    return;
  }

  async activate(): Promise<void> {}
  
  async deactivate(): Promise<void> {
    if (this.inView) this.unregisterViewActions();
  }

  async viewActivated(_viewPath: string): Promise<void> {
    this.inView = true;
    this.registerViewActions();
  }

  async viewDeactivated(_viewPath: string): Promise<void> {
    this.inView = false;
    this.unregisterViewActions();
  }

  async onViewSearch(query: string): Promise<void> {
    lastCalculatorQuery.set(query);
  }

  async search(query: string): Promise<ExtensionResult[]> {
    lastCalculatorQuery.set(query);
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

  private registerViewActions() {
    const copyAction: ExtensionAction = {
      id: "calculator:copy-result",
      title: "Copy Result",
      description: "Copies the currently calculated result to clipboard",
      icon: "📋",
      extensionId: "calculator",
      execute: async () => {
         window.dispatchEvent(new CustomEvent('calculator-action-copy'));
      }
    };
    actionService.registerAction(copyAction);

    const clearAction: ExtensionAction = {
      id: "calculator:clear-input",
      title: "Clear Input",
      description: "Clears the calculator input fields",
      icon: "🧹",
      extensionId: "calculator",
      execute: async () => {
         window.dispatchEvent(new CustomEvent('calculator-action-clear'));
      }
    };
    actionService.registerAction(clearAction);
  }

  private unregisterViewActions() {
    actionService.unregisterAction("calculator:copy-result");
    actionService.unregisterAction("calculator:clear-input");
  }
}

// Export a singleton instance and the default view component as explicitly required by system
const extension = new CalculatorExtension();
export default extension;
export { DefaultView };
