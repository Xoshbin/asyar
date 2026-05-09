import { CommandArgumentsService } from './commandArgumentsService.svelte';
import extensionManager from '../extension/extensionManager.svelte';
import { dispatch } from '../extension/extensionDispatcher.svelte';

/**
 * Module-level singleton for the argument-mode state. Tier 1 commands
 * (including dynamic commands registered by built-in features like Scripts)
 * route through extensionManager.handleCommandAction, which dispatches
 * dynamic ids to their built-in handler and falls through to commandService
 * for manifest commands. Tier 2 commands submit through the extension
 * dispatcher with source: 'argument' so the iframe lifecycle registry
 * handles on-demand mount and delivery.
 */
export const commandArgumentsService = new CommandArgumentsService({
  getManifestByCommandObjectId: (id) => extensionManager.getCommandArgMeta(id),
  executeBuiltInCommand: (id, args) => extensionManager.handleCommandAction(id, args),
  dispatchTier2Argument: ({ extensionId, commandId, args, mode }) =>
    dispatch({
      extensionId,
      kind: 'command',
      payload: { commandId, args: { arguments: args } },
      source: 'argument',
      commandMode: mode,
    }),
});
