import { CommandArgumentsService } from './commandArgumentsService.svelte';
import extensionManager from '../extension/extensionManager.svelte';
import { commandService } from '../extension/commandService.svelte';

/**
 * Module-level singleton for the argument-mode state. Depends on
 * extensionManager for manifest lookup and commandService for execution.
 * Exposed separately from the class so tests can still instantiate the
 * class directly with their own mocked deps.
 */
export const commandArgumentsService = new CommandArgumentsService({
  getManifestByCommandObjectId: (id) => extensionManager.getCommandArgMeta(id),
  executeCommand: (id, args) => commandService.executeCommand(id, args),
});
