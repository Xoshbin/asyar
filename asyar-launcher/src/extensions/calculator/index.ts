import { evaluate } from "mathjs";
import {
  ClipboardItemType,
  type Extension,
  type ExtensionContext,
  type ExtensionResult,
  type IClipboardHistoryService,
  type ILogService,
} from "asyar-extension-sdk";
import type { SearchProvider } from "asyar-extension-sdk/dist/types";

// Helper to check if string contains mathematical expression
function isMathExpression(query: string): boolean {
  // Match expressions with numbers, operators, and parentheses
  return /^[\d\s+\-*/()\^.]+$/.test(query) && /\d/.test(query);
}

class Calculator implements Extension {
  onUnload: any;
  onViewSearch?: ((query: string) => Promise<void>) | undefined;
  searchProviders?: SearchProvider[] | undefined;
  id = "calculator";
  name = "Calculator";
  version = "1.0.0";

  private logService?: ILogService;
  private clipboardService?: IClipboardHistoryService;

  async initialize(context: ExtensionContext): Promise<void> {
    console.log("Initializing Calculator extension");
    this.logService = context.getService<ILogService>("LogService");
    this.clipboardService = context.getService<IClipboardHistoryService>(
      "ClipboardHistoryService"
    );
    this.logService?.info(`${this.name} initialized`);
  }

  async search(query: string): Promise<ExtensionResult[]> {
    this.logService?.info(`Searching with query: ${query}`);

    // Trim the query to handle spaces
    const trimmedQuery = query.trim();

    if (isMathExpression(trimmedQuery)) {
      try {
        const result = evaluate(trimmedQuery);
        return [
          {
            title: `${trimmedQuery} = ${result}`,
            subtitle: "Press Enter to copy to clipboard",
            type: "result",
            viewPath: "greeting/GreetingView",
            action: () => {
              this.clipboardService?.hideWindow();
              console.log("copy math result action");
              this.logService?.info("copy math result");
              this.clipboardService?.writeToClipboard({
                id: result.toString(),
                type: ClipboardItemType.Text,
                content: result.toString(),
                preview: result.toString(),
                createdAt: Date.now(),
                favorite: false,
              });
              this.logService?.info(`Copied result: ${result}`);
              // await ExtensionApi.window.hide();
            },
            score: 1,
          },
        ];
      } catch (error) {
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
    }
    return [];
  }

  async activate(): Promise<void> {
    this.logService?.info(`${this.name} activated`);
  }

  async deactivate(): Promise<void> {
    this.logService?.info(`${this.name} deactivated`);
  }
}

// Create and export a single instance
export default new Calculator();
