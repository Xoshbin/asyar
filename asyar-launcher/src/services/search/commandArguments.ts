import { CommandArgumentsService } from './commandArgumentsService.svelte';
import extensionManager from '../extension/extensionManager.svelte';
import { commandService } from '../extension/commandService.svelte';
import { dispatch } from '../extension/extensionDispatcher.svelte';

/**
 * Module-level singleton for the argument-mode state. Tier 1 commands
 * continue to run through commandService (direct JS path). Tier 2 commands
 * submit through the extension dispatcher with source: 'argument' so the
 * iframe lifecycle registry handles on-demand mount and delivery.
 */
export const commandArgumentsService = new CommandArgumentsService({
  getManifestByCommandObjectId: (id) => extensionManager.getCommandArgMeta(id),
  executeBuiltInCommand: (id, args) => commandService.executeCommand(id, args),
  dispatchTier2Argument: ({ extensionId, commandId, args }) =>
    dispatch({
      extensionId,
      kind: 'command',
      payload: { commandId, args: { arguments: args } },
      source: 'argument',
    }),
});
