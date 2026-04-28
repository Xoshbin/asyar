import type { CommandHandler, ICommandService } from "asyar-sdk/contracts";
import type { ExtensionManager } from './extensionManager.svelte';
import { logService } from "../log/logService";
import { extensionPreferencesService } from "./extensionPreferencesService.svelte";
import { preferencesPromptStore } from "./preferencesPromptStore.svelte";
import * as commands from "../../lib/ipc/commands";

interface RegisteredCommand {
  handler: CommandHandler;
  extensionId: string;
}

/**
 * Service for managing commands registered by extensions
 */
export class CommandService implements ICommandService {
  public commands = $state<Map<string, RegisteredCommand>>(new Map());
  /**
   * Live subtitle overrides keyed by commandObjectId.
   * Updated by updateCommandMetadata() so search results re-render immediately
   * via Svelte reactivity without waiting for the next search.
   * null = explicitly cleared; absent key = fall back to Rust-stored description.
   */
  public liveSubtitles = $state<Record<string, string | null>>({});
  /**
   * Parallel index: composite command object id → bare command id (the `cmd.id`
   * as declared in manifest.json). Used by `executeCommand` to look up the
   * correct preference scope for required-preference gating. Populated via
   * `setShortCommandId`, called from `ExtensionLoader` at registration time.
   */
  private shortCommandIds = new Map<string, string>();
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
   * Register a command with a handler function.
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
   * Associate a bare command id (as declared in manifest.json) with a
   * composite `commandObjectId`. Called by `ExtensionLoader` after
   * `registerCommand`. Required so `executeCommand` can resolve the
   * correct preference scope for required-preference gating.
   */
  setShortCommandId(commandObjectId: string, shortCommandId: string): void {
    this.shortCommandIds.set(commandObjectId, shortCommandId);
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
   * Execute a registered command. Gated on required preferences: if the
   * command's extension has any `required: true` preferences that are
   * unset, the PreferencesPromptStore is opened with the missing set and
   * this call throws. The host's PreferencesPromptHost handles the user's
   * input and re-invokes this method after persisting values.
   *
   * Scheduled tick invocations (`args.scheduledTick === true`) and deep link
   * invocations (`args.deeplinkTrigger === true`) bypass the gate — there's
   * no user to prompt from a background timer or external trigger.
   */
  async executeCommand(
    commandObjectId: string,
    args?: Record<string, any>
  ): Promise<any> {
    logService.debug(`[CommandService] executeCommand called with ID: ${commandObjectId}`);
    const command = this.commands.get(commandObjectId);
    if (!command) {
      throw new Error(`Command not found: ${commandObjectId}`);
    }

    const bypassPreferenceGate = args?.scheduledTick === true || args?.deeplinkTrigger === true;
    const shortCommandId = this.shortCommandIds.get(commandObjectId);
    if (!bypassPreferenceGate && shortCommandId) {
      const missing = await extensionPreferencesService.getMissingRequired(
        command.extensionId,
        shortCommandId
      );
      if (missing.length > 0) {
        preferencesPromptStore.open({
          extensionId: command.extensionId,
          commandId: shortCommandId,
          commandObjectId,
          missing,
        });
        throw new Error(
          `Extension '${command.extensionId}' requires preferences before running command '${shortCommandId}'`
        );
      }
    }

    logService.info(
      `EXTENSION_TRACKED: Executing command: ${commandObjectId} from extension: ${command.extensionId
      } with args: ${JSON.stringify(args || {})}`
    );

    try {
      logService.debug(`[CommandService] Found handler for ${commandObjectId}. Executing...`);
      return await command.handler.execute(args);
    } catch (error) {
      logService.error(`Error executing command ${commandObjectId}: ${error}`);
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
   * Clear all commands for an extension. Also drops any aliases bound to
   * this extension's commands so a re-installed extension starts with a
   * clean alias namespace.
   */
  clearCommandsForExtension(extensionId: string): void {
    const commandsToRemove = this.getCommandsForExtension(extensionId);
    for (const cmd of commandsToRemove) {
      this.unregisterCommand(cmd);
      this.shortCommandIds.delete(cmd);
    }
    void this.#clearAliasesForExtension(extensionId);
  }

  async #clearAliasesForExtension(extensionId: string): Promise<void> {
    // Dynamic imports avoid a circular module dependency between commandService
    // and the aliases feature (which imports commands.ts which imports types
    // owned by this module's neighbors).
    const { aliasStore } = await import('../../built-in-features/aliases/aliasStore.svelte');
    const { aliasService } = await import('../../built-in-features/aliases/aliasService');
    const prefix = `cmd_${extensionId}_`;
    const toRemove = aliasStore.list.filter(a => a.objectId.startsWith(prefix));
    for (const a of toRemove) {
      try {
        await aliasService.unregister(a.alias);
        aliasStore.removeOptimistic(a.alias);
      } catch (e) {
        logService.warn(`Failed to unregister alias '${a.alias}': ${e}`);
      }
    }
  }

  /**
   * Update the runtime subtitle of a command in the Rust search index.
   * Scoped to the calling extension — only commands owned by `extensionId`
   * can be updated.
   *
   * @param extensionId - The extension that owns the command
   * @param commandId   - The bare command ID (as declared in manifest.json)
   * @param subtitle    - The new subtitle text, or null to clear
   */
  async updateCommandMetadata(
    extensionId: string,
    commandId: string,
    subtitle: string | null
  ): Promise<void> {
    const commandObjectId = `cmd_${extensionId}_${commandId}`;
    const registered = this.commands.get(commandObjectId);
    if (!registered || registered.extensionId !== extensionId) {
      throw new Error(
        `Command '${commandId}' not found for extension '${extensionId}'`
      );
    }
    await commands.updateCommandMetadata({ commandObjectId, subtitle });
    // Replace the object reference so Svelte's $state reactivity re-runs
    // any $effect that reads liveSubtitles (e.g. selectionEffects Effect 8).
    this.liveSubtitles = { ...this.liveSubtitles, [commandObjectId]: subtitle };
  }
}

// Create and export a singleton instance
export const commandService = new CommandService();

export default commandService;
