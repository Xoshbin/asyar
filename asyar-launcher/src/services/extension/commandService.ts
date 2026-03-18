import type { CommandHandler, ICommandService } from "asyar-api";
import type { ExtensionManager } from "./extensionManager";
import { writable } from "svelte/store";
import { logService } from "../log/logService";

interface RegisteredCommand {
  handler: CommandHandler;
  extensionId: string;
}

export const commandRegistry = writable<Map<string, RegisteredCommand>>(
  new Map()
);

/**
 * Service for managing commands registered by extensions
 */
class CommandService implements ICommandService {
  private commands: Map<string, RegisteredCommand> = new Map();
  private extensionManager: ExtensionManager | null = null; // Store the reference

  constructor() {
    // Initialize the store immediately
    commandRegistry.set(this.commands);
    // Removed the setTimeout logic
  }

  /**
   * Initialize the service with necessary dependencies.
   * Should be called once during application startup.
   * @param manager - The ExtensionManager instance.
   */
  initialize(manager: ExtensionManager): void {
    if (this.extensionManager) {
      logService.warn("CommandService already initialized.");
      return;
    }
    this.extensionManager = manager;
    logService.debug(
      "CommandService initialized and connected to ExtensionManager."
    );
    // Potentially add logic here that depends on extensionManager if needed
  }

  /**
   * Register a command with a handler function
   */
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string
  ): void {
    this.commands.set(commandId, {
      handler,
      extensionId,
    });

    logService.debug(
      `Registered command: ${commandId} from extension: ${extensionId}`
    );
    commandRegistry.set(this.commands);
  }

  /**
   * Unregister a command
   */
  unregisterCommand(commandId: string): void {
    if (this.commands.delete(commandId)) {
      commandRegistry.set(this.commands); // Update the Svelte store
      logService.debug(`Unregistered command: ${commandId}`);
    } else {
      logService.warn(
        `Attempted to unregister non-existent command: ${commandId}`
      );
    }
  }

  /**
   * Execute a registered command
   */
  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    logService.debug(`[CommandService] executeCommand called with ID: ${commandId}`); // <-- Added log
    const command = this.commands.get(commandId);
    if (!command) {
      throw new Error(`Command not found: ${commandId}`);
    }

    // Log command execution with tracking information
    logService.info(
      `EXTENSION_TRACKED: Executing command: ${commandId} from extension: ${
        command.extensionId
      } with args: ${JSON.stringify(args || {})}`
    );

    // Update usage statistics

    try {
      logService.debug(`[CommandService] Found handler for ${commandId}. Executing...`); // <-- Added log
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
