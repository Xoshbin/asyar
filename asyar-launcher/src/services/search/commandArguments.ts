import { CommandArgumentsService } from './commandArgumentsService.svelte';
import extensionManager from '../extension/extensionManager.svelte';
import { dispatch } from '../extension/extensionDispatcher.svelte';
import * as commands from '../../lib/ipc/commands';
import { searchService } from './SearchService';
import { invalidateTopItemsCache } from './topItemsCache';
import { resetLauncherState } from '../../lib/launcher/launcherReset';
import { logService } from '../log/logService';

/**
 * Module-level singleton for the argument-mode state. Tier 1 commands
 * (including dynamic commands registered by built-in features like Scripts)
 * route through extensionManager.handleCommandAction, which dispatches
 * dynamic ids to their built-in handler and falls through to commandService
 * for manifest commands. Tier 2 commands submit through the extension
 * dispatcher with source: 'argument' so the iframe lifecycle registry
 * handles on-demand mount and delivery.
 *
 * Tier 1 gets the close-and-record sequence from handleCommandAction. The
 * Tier 2 path reaches the dispatcher directly, so it repeats that sequence
 * here, closing the launcher only for background mode the way the
 * search-Enter path in ExtensionLoader does.
 */
export const commandArgumentsService = new CommandArgumentsService({
  getManifestByCommandObjectId: (id) => extensionManager.getCommandArgMeta(id),
  executeBuiltInCommand: (id, args) => extensionManager.handleCommandAction(id, args),
  dispatchTier2Argument: async ({ extensionId, commandId, commandObjectId, args, mode }) => {
    await dispatch({
      extensionId,
      kind: 'command',
      payload: { commandId, args: { arguments: args } },
      source: 'argument',
      commandMode: mode,
    });

    searchService.saveIndex();
    // View commands have just mounted their iframe; closing here would flash
    // it away. Only background dispatch has nothing left on screen.
    if (mode === 'background') {
      void commands.hideWindow().then(resetLauncherState);
    }

    void commands
      .recordItemUsage(commandObjectId)
      .then(() => invalidateTopItemsCache())
      .catch((err) => logService.error(`Failed to record usage for ${commandObjectId}: ${err}`));
  },
});
