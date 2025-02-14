import { invoke } from "@tauri-apps/api/core";
import { Plugin, PluginManifest, PluginCommand } from "../types/Plugin";
import { commandRegistry } from "./commandRegistry";
import { info, error } from "@tauri-apps/plugin-log";
import { SearchResultItem } from "../types";
import { ActionHandlerService } from "./ActionHandlerService";

export class PluginManager {
  [x: string]: any;
  private loadedPlugins: Map<string, Plugin> = new Map();
  private loadedViews: Map<string, React.ComponentType<any>> = new Map();

  async loadPlugin(plugin: Plugin): Promise<void> {
    try {
      info(`Loading plugin: ${plugin.manifest.id}`);

      // Register plugin commands
      if (plugin.manifest.commands) {
        for (const command of plugin.manifest.commands) {
          info(`Registering command: ${command.name}`);
          const searchResultItem: SearchResultItem = {
            id: command.name,
            title: command.name,
            subtitle: command.description,
            icon: "plugin",
            category: "command",
            score: 1,
            action: async () => {
              return {
                type: "SET_VIEW",
                view: "plugin",
                pluginId: plugin.manifest.id,
                viewName: command.handler,
              };
            },
          };
          commandRegistry.registerCommand(plugin.manifest.id, searchResultItem);
        }
      }

      // Pre-load all views
      if (plugin.manifest.views) {
        for (const view of plugin.manifest.views) {
          info(`Pre-loading view: ${view.name}`);
          if (plugin.getView) {
            const viewComponent = await plugin.getView(view.name);
            const viewId = `${plugin.manifest.id}.${view.name}`;
            this.loadedViews.set(viewId, viewComponent);
            info(`View loaded: ${viewId}`);
          }
        }
      }

      // Initialize plugin
      if (plugin.initialize) {
        await plugin.initialize();
      }

      this.loadedPlugins.set(plugin.manifest.id, plugin);
      info(`Plugin loaded successfully: ${plugin.manifest.id}`);
    } catch (err) {
      error(`Failed to load plugin ${plugin.manifest.id}:`);
      throw err;
    }
  }

  async executeCommand(command: string, args?: any): Promise<any> {
    return invoke("execute_plugin_command", {
      command,
      args: JSON.stringify(args),
    });
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    commandRegistry.unregisterPlugin(pluginId);
    this.loadedPlugins.delete(pluginId);
  }

  getPluginView(
    pluginId: string,
    viewName: string
  ): React.ComponentType<any> | undefined {
    const viewId = `${pluginId}.${viewName}`;
    info(`Getting view: ${viewId}`);
    const view = this.loadedViews.get(viewId);
    if (!view) {
      error(`View not found: ${viewId}`);
    }
    return view;
  }

  getLoadedPlugins(): Map<string, Plugin> {
    return this.loadedPlugins;
  }

  async search(query: string): Promise<SearchResultItem[]> {
    const actionHandler = new ActionHandlerService(this.store);
    const results: SearchResultItem[] = Array.from(this.loadedPlugins.values())
      .flatMap((plugin) => commandRegistry.getCommand(plugin.manifest.id))
      .filter((item): item is SearchResultItem => item !== undefined);

    return results.map((item) => ({
      ...item,
      action: async () =>
        actionHandler.executeAction(item.title, item.category),
    }));
  }
}
