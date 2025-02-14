import { Plugin } from "../../types/Plugin";
import { GreetingView } from "./components/GreetingView";
import { info } from "@tauri-apps/plugin-log";
import { log, commands, ui } from "@asyar/api";

const plugin: Plugin = {
  manifest: null!, // Will be injected by plugin loader
  api: null!, // Will be injected by plugin loader

  async initialize() {
    log.info("Greeting plugin initializing...");
    await this.registerCommands?.();
  },

  async getView(viewName: string) {
    log.info(`Getting view: ${viewName}`);
    if (viewName === "greeting") {
      return GreetingView;
    }
    throw new Error(`View ${viewName} not found`);
  },

  async registerCommands() {
    if (!this.manifest) {
      throw new Error("Plugin manifest not loaded");
    }

    commands.register(this.manifest.id, {
      id: "test",
      title: "Test Greeting",
      subtitle: "Show greeting view",
      category: "command",
      icon: "plugin",
      score: 1,
      action: async () => {
        log.info("Executing greeting command");
        return ui.createViewTransition(this.manifest.id, "greeting");
      },
    });

    log.info("Commands registered successfully");
  },
};

export default plugin;
