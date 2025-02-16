import { CalculatorService } from "./services/calculator";
import { Icons } from "../../utils/icons";
import { log, clipboardApi } from "@asyar/api";
import { Extension } from "../../types/Extension";

const extension: Extension = {
  manifest: null!, // Will be injected by extension loader

  async initialize() {
    log.info("Calculator extension initialized");
  },

  getSearchResults(query: string) {
    if (!CalculatorService.isCalculation(query)) {
      return [];
    }

    const result = CalculatorService.calculate(query);
    if (!result) {
      return [];
    }

    return [
      {
        id: "calc_result",
        title: result,
        content: result,
        subtitle: "Click to copy",
        category: "calculation",
        icon: Icons.CALCULATOR,
        score: 1,
        action: async () => {
          await clipboardApi.copyToClipboard(result);
          log.info(`Copied result: ${result}`);
          return { type: "NONE" };
        },
      },
    ];
  },
};

export default extension;
