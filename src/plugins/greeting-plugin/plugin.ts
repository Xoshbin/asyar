import { Plugin } from "../../types/Plugin";
import { GreetingView } from "./components/GreetingView";
import { info } from "@tauri-apps/plugin-log";
import { pluginApi } from "./pluginApi";

const plugin: Plugin = {
  manifest: null!, // Will be injected by plugin loader
  api: null!, // Will be injected by plugin loader

  async initialize() {
    pluginApi.system.log.info("Greeting plugin initializing...");
    await this.registerCommands?.();
  },

  async getView(viewName: string) {
    pluginApi.system.log.info(`Getting view: ${viewName}`);
    if (viewName === "greeting") {
      return GreetingView;
    }
    throw new Error(`View ${viewName} not found`);
  },

  async registerCommands() {
    if (!this.manifest) {
      throw new Error("Plugin manifest not loaded");
    }

    pluginApi.commands.register(this.manifest.id, {
      id: "test",
      title: "Test Greeting",
      subtitle: "Show greeting view",
      category: "command",
      icon: "plugin",
      score: 1,
      action: async () => {
        pluginApi.system.log.info("Executing greeting command");
        return pluginApi.ui.createViewTransition(this.manifest.id, "greeting");
      },
    });

    pluginApi.system.log.info("Commands registered successfully");
  },
};

export default plugin;
