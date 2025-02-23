import type {
  Extension,
  ExtensionResult,
  ExtensionManifest,
} from "../types/extension";
import { writable } from "svelte/store";
import { LogService } from "./logService";
import { discoverExtensions } from "./extensionDiscovery";

export const activeView = writable<string | null>(null);

class ExtensionManager {
  private extensions: Extension[] = [];
  private manifests: Map<string, ExtensionManifest> = new Map();

  async loadExtensions() {
    LogService.info("Starting to load extensions...");
    try {
      // Discover available extensions
      const extensionIds = await discoverExtensions();
      LogService.debug(`Discovered extensions: ${extensionIds.join(", ")}`);

      // Load discovered extensions
      const extensionPairs = await Promise.all(
        extensionIds.map((id) =>
          this.loadExtensionWithManifest(`../extensions/${id}`)
        )
      );

      LogService.debug("Extension modules loaded");

      // Filter out any failed loads and set up extensions
      this.extensions = [];
      this.manifests.clear();

      for (const [extension, manifest] of extensionPairs) {
        if (extension && manifest) {
          this.extensions.push(extension);
          this.manifests.set(manifest.name, manifest);
          LogService.info(`Loaded extension: ${manifest.name}`);
          LogService.debug(
            `Commands: ${manifest.commands
              .map((cmd) => `${cmd.name}(${cmd.trigger})`)
              .join(", ")}`
          );
        }
      }
    } catch (error) {
      LogService.error(`Failed to load extensions: ${error}`);
      this.extensions = [];
      this.manifests.clear();
    }
    LogService.info(`Total extensions loaded: ${this.extensions.length}`);
  }

  private async loadExtensionWithManifest(
    path: string
  ): Promise<[Extension | null, ExtensionManifest | null]> {
    try {
      const [extension, manifest] = await Promise.all([
        import(path).then((m) => m.default),
        import(`${path}/manifest.json`),
      ]);
      return [extension, manifest];
    } catch (error) {
      LogService.error(`Failed to load extension from ${path}: ${error}`);
      return [null, null];
    }
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

    for (let i = 0; i < this.extensions.length; i++) {
      const extension = this.extensions[i];
      const manifest = this.manifests.get(Array.from(this.manifests.keys())[i]);

      if (
        manifest &&
        manifest.commands.some((cmd) => {
          const triggers = cmd.trigger.split("");
          return triggers.some((t) =>
            lowercaseQuery.startsWith(t.toLowerCase())
          );
        })
      ) {
        LogService.debug(`Extension "${manifest.name}" matched query`);
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
