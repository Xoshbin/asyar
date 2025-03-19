import type {
  Extension,
  ExtensionContext,
  IClipboardHistoryService,
  ILogService,
} from "asyar-api";
import { ClipboardItemType } from "asyar-api";
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
