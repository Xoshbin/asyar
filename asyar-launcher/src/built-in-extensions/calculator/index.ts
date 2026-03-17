import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  IExtensionManager,
  ILogService,
  INotificationService
} from "asyar-api";
import type { ExtensionAction } from "asyar-api/dist/types";
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
  private extensionManager?: IExtensionManager;
  private notificationService?: INotificationService;
  private inView: boolean = false;

  onUnload: any;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>("LogService");
    this.extensionManager = context.getService<IExtensionManager>("ExtensionManager");
    this.notificationService = context.getService<INotificationService>("NotificationService");
  }

  async executeCommand(commandId: string, _args?: Record<string, any>): Promise<any> {
    if (commandId === "open-calculator") {
      this.extensionManager?.navigateToView("calculator/DefaultView");
      return { type: "view", viewPath: "calculator/DefaultView" };
    }
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

    const addResult = async (res: string | null | Promise<string | null>, icon: string) => {
      const resolved = await res;
      if (!resolved) return;
      results.push({
        score: 1.0,
        title: `${icon} ${resolved}`,
        subtitle: trimmed,
        type: "result",
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
      addResult(evaluateMath(trimmed), "🧮"),
      addResult(evaluateUnitExpression(trimmed), "📏"),
      addResult(evaluateCurrencyExpression(trimmed), "💵"),
      addResult(evaluateDatetime(trimmed), "📅"),
      addResult(convertBase(trimmed), "🔟")
    ]);

    // Fallback/nav item
    if (results.length > 0) {
      results.push({
        score: 0.8,
        title: "🧮 Open full Calculator view",
        subtitle: `Launch calculator for ${trimmed}`,
        type: "view",
        action: async () => {}, // empty if type is view
        viewPath: "calculator/DefaultView"
      });
    }

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
