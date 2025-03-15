import type { CommandHandler } from "asyar-extension-sdk";
import type { ICommandService } from "asyar-extension-sdk";
import { writable, get } from "svelte/store";
import {logService} from "./logService";

export const commandRegistry = writable<
  Map<string, { handler: CommandHandler; extensionId: string }>
>(new Map());

/**
 * Service for managing commands registered by extensions
 */
class CommandService implements ICommandService {
  private commands: Map<
    string,
    { handler: CommandHandler; extensionId: string }
  > = new Map();

  constructor() {
    // Initialize the store with an empty map
    commandRegistry.set(this.commands);
  }

  /**
   * Register a command with a handler function
   */
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string
  ): void {
    this.commands.set(commandId, { handler, extensionId });
    logService.debug(
      `Registered command: ${commandId} from extension: ${extensionId}`
    );
    commandRegistry.set(this.commands);
  }

  /**
   * Unregister a command
   */
  unregisterCommand(commandId: string): void {
    this.commands.delete(commandId);
    commandRegistry.set(this.commands);
    logService.debug(`Unregistered command: ${commandId}`);
  }

  /**
   * Execute a registered command
   */
  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    const command = this.commands.get(commandId);
    if (!command) {
      throw new Error(`Command not found: ${commandId}`);
    }

    logService.debug(`Executing command: ${commandId}`);
    try {
      return await command.handler.execute(args);
    } catch (error) {
      logService.error(`Error executing command ${commandId}: ${error}`);
      throw error;
    }
  }

  /**
   * Get all registered command IDs
   */
  getCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * Get all commands registered by a specific extension
   */
  getCommandsForExtension(extensionId: string): string[] {
    return Array.from(this.commands.entries())
      .filter(([_, value]) => value.extensionId === extensionId)
      .map(([key, _]) => key);
  }

  /**
   * Clear all commands for an extension
   */
  clearCommandsForExtension(extensionId: string): void {
    const commandsToRemove = this.getCommandsForExtension(extensionId);
    for (const cmd of commandsToRemove) {
      this.unregisterCommand(cmd);
    }
  }
}

// Create and export a singleton instance
export const commandService = new CommandService();
export default commandService;
