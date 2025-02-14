import { Plugin } from "../../types/Plugin";
import { CalculatorService } from "./services/calculator";
import { Icons } from "../../utils/icons";
import { pluginApi } from "./pluginApi";

const plugin: Plugin = {
  manifest: null!, // Will be injected by plugin loader

  async initialize() {
    pluginApi.system.log.info("Calculator plugin initialized");
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
          await pluginApi.clipboard.write(result);
          pluginApi.system.log.info(`Copied result: ${result}`);
        },
      },
    ];
  },
};

export default plugin;
