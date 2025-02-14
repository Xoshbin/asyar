import { invoke } from "@tauri-apps/api/core";
import {
  Extension,
  ExtensionManifest,
  ExtensionCommand,
} from "../types/Extension";
import { commandRegistry } from "./commandRegistry";
import { info, error } from "@tauri-apps/plugin-log";
import { SearchResultItem } from "../types";
import { ActionHandlerService } from "./ActionHandlerService";

export class ExtensionManager {
  [x: string]: any;
  private loadedExtensions: Map<string, Extension> = new Map();
  private loadedViews: Map<string, React.ComponentType<any>> = new Map();

  async loadExtension(extension: Extension): Promise<void> {
    try {
      info(`Loading extension: ${extension.manifest.id}`);

      // Register extension commands
      if (extension.manifest.commands) {
        for (const command of extension.manifest.commands) {
          info(`Registering command: ${command.name}`);
          const searchResultItem: SearchResultItem = {
            id: command.name,
            title: command.name,
            subtitle: command.description,
            icon: "extension",
            category: "command",
            score: 1,
            action: async () => {
              return {
                type: "SET_VIEW",
                view: "extension",
                extensionId: extension.manifest.id,
                viewName: command.handler,
              };
            },
          };
          commandRegistry.registerCommand(
            extension.manifest.id,
            searchResultItem
          );
        }
      }

      // Pre-load all views
      if (extension.manifest.views) {
        for (const view of extension.manifest.views) {
          info(`Pre-loading view: ${view.name}`);
          if (extension.getView) {
            const viewComponent = await extension.getView(view.name);
            const viewId = `${extension.manifest.id}.${view.name}`;
            this.loadedViews.set(viewId, viewComponent);
            info(`View loaded: ${viewId}`);
          }
        }
      }

      // Initialize extension
      if (extension.initialize) {
        await extension.initialize();
      }

      this.loadedExtensions.set(extension.manifest.id, extension);
      info(`Extension loaded successfully: ${extension.manifest.id}`);
    } catch (err) {
      error(`Failed to load extension ${extension.manifest.id}:`);
      throw err;
    }
  }

  async executeCommand(command: string, args?: any): Promise<any> {
    return invoke("execute_extension_command", {
      command,
      args: JSON.stringify(args),
    });
  }

  async unloadExtension(extensionId: string): Promise<void> {
    commandRegistry.unregisterExtension(extensionId);
    this.loadedExtensions.delete(extensionId);
  }

  getExtensionView(
    extensionId: string,
    viewName: string
  ): React.ComponentType<any> | undefined {
    const viewId = `${extensionId}.${viewName}`;
    info(`Getting view: ${viewId}`);
    const view = this.loadedViews.get(viewId);
    if (!view) {
      error(`View not found: ${viewId}`);
    }
    return view;
  }

  getLoadedExtensions(): Map<string, Extension> {
    return this.loadedExtensions;
  }

  async search(query: string): Promise<SearchResultItem[]> {
    const actionHandler = new ActionHandlerService(this.store);
    const results: SearchResultItem[] = Array.from(
      this.loadedExtensions.values()
    )
      .flatMap((extension) => commandRegistry.getCommand(extension.manifest.id))
      .filter((item): item is SearchResultItem => item !== undefined);

    return results.map((item) => ({
      ...item,
      action: async () =>
        actionHandler.executeAction(item.title, item.category),
    }));
  }
}
