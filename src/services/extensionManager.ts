import type { Extension, ExtensionResult } from "../types/extension";
import { writable } from "svelte/store";
import { LogService } from "./logService";

export const activeView = writable<string | null>(null);

class ExtensionManager {
  private extensions: Extension[] = [];

  async loadExtensions() {
    LogService.info("Starting to load extensions...");
    try {
      const greetingExtension = await import("../extensions/greeting");
      LogService.debug("Greeting extension module loaded");

      if (!greetingExtension.default) {
        throw new Error("Greeting extension has no default export");
      }

      this.extensions = [greetingExtension.default];

      for (const ext of this.extensions) {
        LogService.info(`Loaded extension: ${ext.manifest.name}`);
        LogService.debug(
          `Commands: ${ext.manifest.commands
            .map((cmd) => `${cmd.name}(${cmd.trigger})`)
            .join(", ")}`
        );
      }
    } catch (error) {
      LogService.error(`Failed to load extensions: ${error}`);
      this.extensions = [];
    }
    LogService.info(`Total extensions loaded: ${this.extensions.length}`);
  }

  async searchAll(query: string): Promise<ExtensionResult[]> {
    if (this.extensions.length === 0) {
      LogService.debug("No extensions loaded, skipping search");
      return [];
    }

    const results: ExtensionResult[] = [];
    const lowercaseQuery = query.toLowerCase();

    LogService.debug(
      `Searching ${this.extensions.length} extensions with query: "${query}"`
    );

    for (const extension of this.extensions) {
      if (
        extension.manifest.commands.some((cmd) =>
          lowercaseQuery.startsWith(cmd.trigger.toLowerCase())
        )
      ) {
        LogService.debug(
          `Extension "${extension.manifest.name}" matched query`
        );
        const extensionResults = await extension.search(query);
        results.push(...extensionResults);
      }
    }

    LogService.debug(`Found ${results.length} extension results`);
    return results;
  }

  navigateToView(viewPath: string) {
    activeView.set(viewPath);
  }

  closeView() {
    activeView.set(null);
  }
}

export default new ExtensionManager();
