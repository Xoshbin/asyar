import { evaluate } from "mathjs";
import {
  ClipboardItemType,
  type Extension,
  type ExtensionContext,
  type ExtensionResult,
  type IClipboardHistoryService,
  type ILogService,
} from "asyar-extension-sdk";
import type {
  ExtensionAction,
  IActionService,
} from "asyar-extension-sdk/dist/types";

// Helper to check if string contains mathematical expression
function isMathExpression(query: string): boolean {
  // Match expressions with numbers, operators, and parentheses
  return /^[\d\s+\-*/()\^.]+$/.test(query) && /\d/.test(query);
}

class Calculator implements Extension {
  onUnload: any;
  onViewSearch?: ((query: string) => Promise<void>) | undefined;
  id = "calculator";
  name = "Calculator";
  version = "1.0.0";

  private logService?: ILogService;
  private clipboardService?: IClipboardHistoryService;
  private actionService?: IActionService;
  private currentResult: number | null = null;

  async initialize(context: ExtensionContext): Promise<void> {
    console.log("Initializing Calculator extension");
    this.logService = context.getService<ILogService>("LogService");
    this.clipboardService = context.getService<IClipboardHistoryService>(
      "ClipboardHistoryService"
    );
    this.actionService = context.getService<IActionService>("ActionService");
    this.logService?.info(`${this.name} initialized`);
  }

  async search(query: string): Promise<ExtensionResult[]> {
    this.logService?.info(`Searching with query: ${query}`);

    // Clean up previous result actions if they exist
    if (this.currentResult !== null) {
      this.removeResultActions();
    }

    // Trim the query to handle spaces
    const trimmedQuery = query.trim();

    if (isMathExpression(trimmedQuery)) {
      try {
        const result = evaluate(trimmedQuery);
        this.currentResult = result;

        // Register a result-specific action
        this.registerResultActions(result, trimmedQuery);

        return [
          {
            title: `${trimmedQuery} = ${result}`,
            subtitle: "Press Enter to copy to clipboard",
            type: "result", // This "result" type is important for context switching
            viewPath: "greeting/GreetingView",
            action: () => {
              this.copyResultToClipboard(result);
            },
            score: 1,
          },
        ];
      } catch (error) {
        // Clear current result since we have an error
        this.currentResult = null;

        this.logService?.debug(`Calculator error: ${error}`);
        if (query.length > 1) {
          // Only show error if query is substantial
          return [
            {
              title: "Invalid expression",
              subtitle: String(error),
              type: "result",
              action: () => {},
              score: 0,
            },
          ];
        }
      }
    } else {
      // No math expression, clear current result
      this.currentResult = null;
    }

    return [];
  }

  private registerResultActions(result: number, expression: string) {
    if (!this.actionService) return;

    // Register a copy action for the current result
    const copyAction: ExtensionAction = {
      id: "calculator-copy-result",
      title: "Copy Calculation Result",
      description: `Copy ${result} to clipboard`,
      icon: "📋",
      extensionId: this.id,
      category: "result-action",
      execute: () => {
        this.copyResultToClipboard(result);
      },
    };

    // Register action to round the result (if it's not an integer)
    if (!Number.isInteger(result)) {
      const roundAction: ExtensionAction = {
        id: "calculator-round-result",
        title: "Round Result",
        description: `Round ${result} to nearest integer`,
        icon: "🔄",
        extensionId: this.id,
        category: "result-action",
        execute: () => {
          const roundedResult = Math.round(result);
          // Update the search query
          const searchInput = document.querySelector(
            'input[type="text"]'
          ) as HTMLInputElement;
          if (searchInput) {
            searchInput.value = `${expression} = ${roundedResult}`;
            searchInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
        },
      };

      this.actionService.registerAction(roundAction);
    }

    this.actionService.registerAction(copyAction);
    this.logService?.debug("Calculator result actions registered");
  }

  private removeResultActions() {
    if (!this.actionService) return;

    // Remove result-specific actions
    this.actionService.unregisterAction("calculator-copy-result");
    this.actionService.unregisterAction("calculator-round-result");

    this.logService?.debug("Calculator result actions removed");
  }

  private copyResultToClipboard(result: number) {
    this.clipboardService?.hideWindow();
    this.logService?.info("Copying calculation result");
    this.clipboardService?.writeToClipboard({
      id: result.toString(),
      type: ClipboardItemType.Text,
      content: result.toString(),
      preview: result.toString(),
      createdAt: Date.now(),
      favorite: false,
    });
    this.logService?.info(`Copied result: ${result}`);
  }

  async activate(): Promise<void> {
    this.logService?.info(`${this.name} activated`);
  }

  async deactivate(): Promise<void> {
    // Clean up any result actions
    if (this.currentResult !== null) {
      this.removeResultActions();
    }

    this.logService?.info(`${this.name} deactivated`);
  }
}

// Create and export a single instance
export default new Calculator();
