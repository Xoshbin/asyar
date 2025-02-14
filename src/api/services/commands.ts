import { info } from "@tauri-apps/plugin-log";
import type { SearchResultItem } from "../../types";
import { commandRegistry } from "../../services/commandRegistry";

export const commands = {
  register(pluginId: string, command: SearchResultItem): void {
    info(
      `[Commands API] Registering command: ${command.id} for plugin: ${pluginId}`
    );
    commandRegistry.registerCommand(pluginId, command);
  },

  unregister(pluginId: string): void {
    info(`[Commands API] Unregistering commands for plugin: ${pluginId}`);
    commandRegistry.unregisterPlugin(pluginId);
  },

  search(query: string): SearchResultItem[] {
    return commandRegistry.searchCommands(query);
  },
} as const;
