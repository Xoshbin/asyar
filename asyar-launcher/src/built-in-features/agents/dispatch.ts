import { getCurrentAgentService } from './agentService.svelte';
import { agentsManager } from './agentsManager.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { dispatchSilentAgentCommand } from './silentDispatch';

/**
 * Entry point invoked by the dynamic-command dispatcher when the user
 * picks (or hotkeys) an agent row in the launcher.
 *
 * Routing:
 *  - `agent.silent === false` → open the chat view (default, unchanged
 *    flow).
 *  - `agent.silent === true`  → hand off to `dispatchSilentAgentCommand`
 *    which runs the agent headlessly and applies its `outputAction` to
 *    the result. The launcher window stays closed; `agentsManager` and
 *    `viewManager` are not touched. See `silentDispatch.ts` for the
 *    Run-tracker suppression contract.
 */
export async function dispatchAgentCommand(
  dynamicId: string,
  _args?: unknown,
): Promise<void> {
  const service = getCurrentAgentService();
  const agent = service.getById(dynamicId);
  if (!agent) {
    throw new Error(`agent '${dynamicId}' not found`);
  }

  if (agent.silent) {
    await dispatchSilentAgentCommand({ agentId: agent.id });
    return;
  }

  agentsManager.currentAgentId = agent.id;
  const threads = await service.listThreads(agent.id);
  agentsManager.currentThreadId = threads[0]?.id ?? null;
  viewManager.navigateToView('agents/AgentChatView');
}
