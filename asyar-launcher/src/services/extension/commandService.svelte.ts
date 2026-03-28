import type { CommandHandler, ICommandService } from "asyar-sdk";
import type { ExtensionManager } from './extensionManager.svelte';
import { logService } from "../log/logService";

interface RegisteredCommand {
  handler: CommandHandler;
  extensionId: string;
}

/**
 * Service for managing commands registered by extensions
 */
export class CommandService implements ICommandService {
  public commands = $state<Map<string, RegisteredCommand>>(new Map());
  private extensionManager: ExtensionManager | null = null;

  constructor() {
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
  }

  /**
   * Unregister a command
   */
  unregisterCommand(commandId: string): void {
    if (this.commands.delete(commandId)) {
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
    logService.debug(`[CommandService] executeCommand called with ID: ${commandId}`);
    const command = this.commands.get(commandId);
    if (!command) {
      throw new Error(`Command not found: ${commandId}`);
    }

    logService.info(
      `EXTENSION_TRACKED: Executing command: ${commandId} from extension: ${
        command.extensionId
      } with args: ${JSON.stringify(args || {})}`
    );

    try {
      logService.debug(`[CommandService] Found handler for ${commandId}. Executing...`);
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

// For backward compatibility while migrating (to be removed in final cleanup)
export const commandRegistry = {
  get subscribe() {
    // This is a hack to support legacy Svelte 4 subscribers if any exist
    // but better to just use Svelte 5 $derived or similar in consumers.
    // For now, we return the map itself.
    return (fn: (v: Map<string, RegisteredCommand>) => void) => {
       fn(commandService.commands);
       return () => {};
    };
  }
};

export default commandService;
