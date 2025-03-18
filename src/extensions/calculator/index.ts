import {
  ClipboardItemType,
  type Extension,
  type ExtensionContext,
  type IClipboardHistoryService,
  type ILogService,
} from "asyar-api";
import type { IActionService } from "asyar-api/dist/types";
import { evaluate } from "mathjs";

class Calculator implements Extension {
  onUnload: any;
  onViewSearch?: ((query: string) => Promise<void>) | undefined;

  private logService?: ILogService;
  private clipboardService?: IClipboardHistoryService;
  private actionService?: IActionService;
  private context?: ExtensionContext;

  async initialize(context: ExtensionContext): Promise<void> {
    this.context = context;
    this.logService = context.getService<ILogService>("LogService");
    this.clipboardService = context.getService<IClipboardHistoryService>(
      "ClipboardHistoryService"
    );
    this.actionService = context.getService<IActionService>("ActionService");
    this.logService?.info("Calculator extension initialized");
  }

  // Register commands for the calculator
  async registerCommands(): Promise<void> {
    if (!this.context) {
      this.logService?.error(
        "Cannot register commands - context is not initialized"
      );
      return;
    }

    // Register the math evaluation command
    this.context.registerCommand("evaluate-math", {
      execute: async (args) => {
        const expression = args?.input || "";
        try {
          // Validate that this is a math expression
          if (!/^[\d\s+\-*/()\^.]+$/.test(expression)) {
            throw new Error("Not a valid math expression");
          }

          const result = evaluate(expression);

          return {
            type: "inline",
            result: result,
            expression: expression,
            displayTitle: `${expression} = ${result}`,
            displaySubtitle: "Press Enter to copy result",
          };
        } catch (error) {
          return {
            type: "inline",
            error: String(error),
            displayTitle: `Could not evaluate: ${expression}`,
            displaySubtitle: String(error),
          };
        }
      },
    });

    this.logService?.info("Calculator commands registered");
  }

  // Execute a command
  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(
      `Executing command ${commandId} with args ${JSON.stringify(args || {})}`
    );

    switch (commandId) {
      case "evaluate-math":
        const mathExpr = args?.input || "";
        try {
          const result = evaluate(mathExpr);
          return {
            type: "inline",
            result: result,
            expression: mathExpr,
            displayTitle: `${mathExpr} = ${result}`,
            displaySubtitle: "Press Enter to copy result",
          };
        } catch (error) {
          return {
            type: "inline",
            error: String(error),
            displayTitle: `Could not evaluate: ${mathExpr}`,
            displaySubtitle: String(error),
          };
        }

      case "evaluate-math-action":
      case "calc-action":
        // Handle the result click action
        if (args?.result) {
          this.copyToClipboard(String(args.result));
          return { success: true };
        }
        return { success: false };

      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  // Helper method to copy text to clipboard
  private copyToClipboard(text: string): void {
    if (this.clipboardService) {
      this.clipboardService.writeToClipboard({
        id: text,
        type: ClipboardItemType.Text,
        content: text,
        preview: text,
        createdAt: Date.now(),
        favorite: false,
      });
      this.clipboardService.hideWindow();
    }
  }

  async activate(): Promise<void> {
    this.logService?.info("Calculator extension activated");
  }

  async deactivate(): Promise<void> {
    this.logService?.info("Calculator extension deactivated");
  }
}

export default new Calculator();
