import { log } from "./log";
import type { SearchResultItem } from "../../types";
import { commandRegistry } from "../../services/commandRegistry";

export const commands = {
  register(extensionId: string, command: SearchResultItem): void {
    log.info(
      `[Commands API] Registering command: ${command.id} for extension: ${extensionId}`
    );
    commandRegistry.registerCommand(extensionId, command);
  },

  unregister(extensionId: string): void {
    log.info(
      `[Commands API] Unregistering commands for extension: ${extensionId}`
    );
    commandRegistry.unregisterExtension(extensionId);
  },

  search(query: string): SearchResultItem[] {
    return commandRegistry.searchCommands(query);
  },
} as const;
