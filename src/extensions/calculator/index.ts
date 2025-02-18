import type {
  Extension,
  ExtensionManifest,
  ExtensionResult,
} from "../../types/extension";
import { LogService } from "../../services/logService";
import manifest from "./manifest.json";
import { evaluate } from "mathjs";

// Helper to check if string contains mathematical expression
function isMathExpression(query: string): boolean {
  // Match if string contains numbers and at least one operator
  return /^\d+[\d\s+\-*/^()]*\d+$/.test(query);
}

const extension: Extension = {
  manifest: manifest as ExtensionManifest,
  async search(query: string): Promise<ExtensionResult[]> {
    LogService.debug(`Calculator extension searching: "${query}"`);

    // Check if query looks like a math expression
    if (isMathExpression(query)) {
      try {
        const result = evaluate(query);
        LogService.debug(`Calculated ${query} = ${result}`);

        return [
          {
            title: `${query} = ${result}`,
            subtitle: "Press Enter to copy to clipboard",
            type: "result",
            action: async () => {
              await navigator.clipboard.writeText(result.toString());
              LogService.info(`Copied result: ${result}`);
            },
          },
        ];
      } catch (error) {
        LogService.debug(`Calculator error: ${error}`);
        if (query.length > 1) {
          // Only show error if query is substantial
          return [
            {
              title: "Invalid expression",
              subtitle: String(error),
              type: "result",
              action: () => {},
            },
          ];
        }
      }
    }
    return [];
  },
};

export default extension;
