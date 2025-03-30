import type { CommandHandler, CommandMatch, CommandMatcher } from "asyar-api";
import type { ICommandService } from "asyar-api";
import { writable, get } from "svelte/store";
import { logService } from "../log/logService";
import Fuse from "fuse.js";

interface RegisteredCommand {
  handler: CommandHandler;
  extensionId: string;
  matchers: CommandMatcher[];
}

export const commandRegistry = writable<Map<string, RegisteredCommand>>(
  new Map()
);

/**
 * Service for managing commands registered by extensions
 */
class CommandService implements ICommandService {
  private commands: Map<string, RegisteredCommand> = new Map();
  private extensionManager: any; // Will be set during initialization
  private extensionManifestCache: Map<string, any> = new Map(); // Cache for extension manifests

  constructor() {
    commandRegistry.set(this.commands);
    // We'll set the extension manager reference when it's available
    setTimeout(() => {
      try {
        // Wait for extension manager to be initialized and available
        import("../index").then((services) => {
          this.extensionManager = services.extensionManager;
          logService.debug("CommandService connected to ExtensionManager");
        });
      } catch (e) {
        logService.error(`Failed to get ExtensionManager reference: ${e}`);
      }
    }, 100);
  }

  /**
   * Register a command with a handler function and optional matchers
   */
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string,
    matchers?: CommandMatcher[]
  ): void {
    if (matchers) {
      // Use provided matchers
      this.commands.set(commandId, { handler, extensionId, matchers });
    } else {
      // Create appropriate matcher based on trigger type
      let defaultMatchers: CommandMatcher[] = [];

      this.commands.set(commandId, {
        handler,
        extensionId,
        matchers: defaultMatchers,
      });
    }

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

    // Log command execution with tracking information
    logService.info(
      `EXTENSION_TRACKED: Executing command: ${commandId} from extension: ${
        command.extensionId
      } with args: ${JSON.stringify(args || {})}`
    );

    // Update usage statistics

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

  /**
   * Find a matching command for the query
   * Returns [extensionId, commandId, args] if found, null otherwise
   */
  findMatchingCommand(query: string): [string, string, any] | null {
    if (!query || !query.trim()) return null;

    let bestMatch: {
      command: RegisteredCommand;
      commandId: string;
      match: CommandMatch;
    } | null = null;

    // Try all registered commands
    for (const [commandId, command] of this.commands.entries()) {
      // Check each matcher for this command
      for (const matcher of command.matchers) {
        try {
          if (matcher.canHandle(query)) {
            const match = matcher.match(query);
            if (
              match &&
              (!bestMatch || match.confidence > bestMatch.match.confidence)
            ) {
              bestMatch = { command, commandId, match };
            }
          }
        } catch (error) {
          logService.error(
            `Error in matcher for command ${commandId}: ${error}`
          );
        }
      }
    }

    // Return the best match if found
    if (bestMatch) {
      const extensionId = bestMatch.command.extensionId;

      // Log the successful match for tracking
      logService.info(
        `EXTENSION_MATCHED: Query "${query}" matched extension: ${extensionId}, command: ${bestMatch.commandId} with confidence: ${bestMatch.match.confidence}`
      );

      return [extensionId, bestMatch.commandId, bestMatch.match.args || {}];
    }

    return null;
  }
}

// Create and export a singleton instance
export const commandService = new CommandService();
export default commandService;
