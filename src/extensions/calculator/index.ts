import type { Extension, ExtensionResult } from "../../types/extension";
import { ExtensionApi } from "../../api/extensionApi";
import { evaluate } from "mathjs";

// Helper to check if string contains mathematical expression
function isMathExpression(query: string): boolean {
  // Match expressions with numbers, operators, and parentheses
  return /^[\d\s+\-*/()\^.]+$/.test(query) && /\d/.test(query);
}

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    ExtensionApi.log.debug(`Calculator checking expression: "${query}"`);

    // Trim the query to handle spaces
    const trimmedQuery = query.trim();

    if (isMathExpression(trimmedQuery)) {
      try {
        const result = evaluate(trimmedQuery);
        ExtensionApi.log.debug(`Calculated ${trimmedQuery} = ${result}`);

        return [
          {
            title: `${trimmedQuery} = ${result}`,
            subtitle: "Press Enter to copy to clipboard",
            type: "result",
            action: async () => {
              await ExtensionApi.clipboard.writeText(result.toString());
              ExtensionApi.log.info(`Copied result: ${result}`);
              await ExtensionApi.window.hide();
            },
            score: 0,
          },
        ];
      } catch (error) {
        ExtensionApi.log.debug(`Calculator error: ${error}`);
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
  },
};

export default extension;
