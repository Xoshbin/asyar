import { info } from "@tauri-apps/plugin-log";
import type { SearchResultItem } from "../../types";
import { commandRegistry } from "../../services/commandRegistry";

export const commands = {
  register(extensionId: string, command: SearchResultItem): void {
    info(
      `[Commands API] Registering command: ${command.id} for extension: ${extensionId}`
    );
    commandRegistry.registerCommand(extensionId, command);
  },

  unregister(extensionId: string): void {
    info(`[Commands API] Unregistering commands for extension: ${extensionId}`);
    commandRegistry.unregisterExtension(extensionId);
  },

  search(query: string): SearchResultItem[] {
    return commandRegistry.searchCommands(query);
  },
} as const;
