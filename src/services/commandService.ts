import type { CommandHandler, CommandMatch, CommandMatcher } from "asyar-api";
import type { ICommandService } from "asyar-api";
import { writable, get } from "svelte/store";
import { logService } from "./logService";
import Fuse from "fuse.js";

interface RegisteredCommand {
  handler: CommandHandler;
  extensionId: string;
  matchers: CommandMatcher[];
}

// Store for tracking command usage statistics
export const commandUsageStats = writable<Record<string, number>>({});

export const commandRegistry = writable<Map<string, RegisteredCommand>>(
  new Map()
);

// Default prefix matcher for simple commands
class PrefixMatcher implements CommandMatcher {
  private trigger: string;
  private commandId: string;

  constructor(trigger: string, commandId: string) {
    this.trigger = trigger.toLowerCase();
    this.commandId = commandId;
  }

  canHandle(query: string): boolean {
    return query.toLowerCase().startsWith(this.trigger);
  }

  match(query: string): CommandMatch | null {
    const lowercaseQuery = query.toLowerCase();
    if (lowercaseQuery.startsWith(this.trigger)) {
      // Extract arguments after the trigger
      const args = query.substring(this.trigger.length).trim();
      return {
        confidence: 100,
        commandId: this.commandId,
        args: args ? { input: args } : {},
      };
    }
    return null;
  }
}

// Pattern matcher using regex for more complex matches
class PatternMatcher implements CommandMatcher {
  private pattern: RegExp;
  private commandId: string;
  private argNames: string[];
  private confidenceScore: number;

  constructor(
    pattern: RegExp,
    commandId: string,
    argNames: string[] = [],
    confidenceScore = 80
  ) {
    this.pattern = pattern;
    this.commandId = commandId;
    this.argNames = argNames;
    this.confidenceScore = confidenceScore;
  }

  canHandle(query: string): boolean {
    return this.pattern.test(query);
  }

  match(query: string): CommandMatch | null {
    const match = query.match(this.pattern);
    if (match) {
      const args: Record<string, any> = {};

      // Extract named groups from regex if available
      if (match.groups) {
        Object.assign(args, match.groups);
      }
      // Otherwise, assign captured groups to defined argNames
      else if (match.length > 1 && this.argNames.length > 0) {
        for (let i = 0; i < this.argNames.length && i + 1 < match.length; i++) {
          args[this.argNames[i]] = match[i + 1];
        }
      }

      // Always include the full match as input
      args.input = query;

      return {
        confidence: this.confidenceScore,
        commandId: this.commandId,
        args,
      };
    }
    return null;
  }
}

// Add a Fuse-based matcher for fuzzy command matching
class FuseMatcher implements CommandMatcher {
  private fuse: Fuse<{ id: string; trigger: string }>;
  private commandId: string;

  constructor(trigger: string, commandId: string, threshold = 0.4) {
    this.commandId = commandId;

    // Configure Fuse instance for this matcher
    this.fuse = new Fuse([{ id: commandId, trigger: trigger }], {
      keys: ["trigger"],
      threshold: threshold,
      includeScore: true,
    });
  }

  canHandle(query: string): boolean {
    const results = this.fuse.search(query);
    return results.length > 0 && results[0].score < 0.6; // Lower score is better match
  }

  match(query: string): CommandMatch | null {
    const results = this.fuse.search(query);

    if (results.length > 0 && results[0].score < 0.6) {
      // Convert Fuse score (0-1, lower is better) to confidence (0-100, higher is better)
      const confidence = Math.round((1 - results[0].score) * 100);

      return {
        confidence: confidence,
        commandId: this.commandId,
        args: { input: query },
      };
    }

    return null;
  }
}

// Add a specialized character set matcher that preserves exact matching for calculators
class CharacterSetMatcher implements CommandMatcher {
  private allowedChars: Set<string>;
  private commandId: string;

  constructor(characterSet: string, commandId: string) {
    this.allowedChars = new Set(characterSet.split(""));
    this.commandId = commandId;
  }

  canHandle(query: string): boolean {
    return (
      query.length > 0 &&
      [...query].every((char) => this.allowedChars.has(char))
    );
  }

  match(query: string): CommandMatch | null {
    if (this.canHandle(query)) {
      return {
        confidence: 90, // High confidence for exact character set match
        commandId: this.commandId,
        args: { input: query },
      };
    }
    return null;
  }
}

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
        import("./index").then((services) => {
          this.extensionManager = services.extensionManager;
          logService.debug("CommandService connected to ExtensionManager");
        });
      } catch (e) {
        logService.error("Failed to get ExtensionManager reference:", e);
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
      // Create default matchers based on command information
      const extCmd = commandId.split(".").pop() || commandId;

      // Get trigger from manifest if available
      const trigger = this.getTriggerForCommand(extensionId, extCmd) || extCmd;

      // Create appropriate matcher based on trigger type
      let defaultMatchers: CommandMatcher[] = [];

      if (this.isCharacterSetTrigger(trigger)) {
        // For character sets like calculator operators
        defaultMatchers.push(new CharacterSetMatcher(trigger, commandId));
      } else {
        // Standard prefix matcher for command words
        defaultMatchers.push(new PrefixMatcher(trigger, commandId));

        // Add fuzzy matcher with lower confidence
        defaultMatchers.push(new FuseMatcher(trigger, commandId, 0.4));
      }

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
    commandUsageStats.update((stats) => {
      const key = `${command.extensionId}.${commandId}`;
      stats[key] = (stats[key] || 0) + 1;
      return stats;
    });

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

  // Helper to determine if trigger is a character set
  private isCharacterSetTrigger(trigger: string): boolean {
    // Character sets typically:
    // 1. Have no spaces
    // 2. Contain multiple special characters or repeating characters
    // 3. Are longer than typical command triggers

    if (!trigger || trigger.includes(" ")) return false;

    // Check for multiple types of characters
    const hasDigits = /\d/.test(trigger);
    const hasLetters = /[a-zA-Z]/.test(trigger);
    const hasSymbols = /[^\w\s]/.test(trigger);

    // Count unique vs. total characters ratio to detect repeating patterns
    const uniqueChars = new Set(trigger.split("")).size;
    const totalChars = trigger.length;
    const uniqueRatio = uniqueChars / totalChars;

    // If it has many characters with low uniqueness, it's likely a character set
    const isLongTrigger = trigger.length >= 5;
    const hasVariedChars =
      (hasDigits && hasSymbols) || (hasLetters && hasSymbols);
    const hasRepeatingPattern = uniqueRatio < 0.7;

    // Special case for calculator-like triggers
    if (trigger.includes("0123456789")) return true;

    return isLongTrigger && (hasVariedChars || hasRepeatingPattern);
  }

  // Helper to get trigger for a command from manifest
  private getTriggerForCommand(
    extensionId: string,
    commandId: string
  ): string | undefined {
    try {
      // Try to get from cache first
      const cacheKey = `${extensionId}:${commandId}`;
      if (this.extensionManifestCache.has(cacheKey)) {
        return this.extensionManifestCache.get(cacheKey);
      }

      // If extension manager is available, get command definition from there
      if (this.extensionManager) {
        const manifests = this.extensionManager.getManifests?.() || [];
        const manifest = manifests.find((m) => m.id === extensionId);

        if (manifest?.commands) {
          const command = manifest.commands.find((c) => c.id === commandId);
          if (command?.trigger) {
            // Cache the result
            this.extensionManifestCache.set(cacheKey, command.trigger);
            return command.trigger;
          }
        }
      }

      return undefined;
    } catch (error) {
      logService.error(
        `Error getting trigger for command ${commandId}: ${error}`
      );
      return undefined;
    }
  }
}

// Create and export a singleton instance
export const commandService = new CommandService();
export { PrefixMatcher, PatternMatcher, FuseMatcher, CharacterSetMatcher };
export default commandService;
