import { getCurrentAgentService } from './agentService.svelte';
import { agentsManager } from './agentsManager.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

export async function dispatchAgentCommand(
  dynamicId: string,
  _args?: unknown,
): Promise<void> {
  const agent = getCurrentAgentService().getById(dynamicId);
  if (!agent) {
    throw new Error(`agent '${dynamicId}' not found`);
  }
  agentsManager.currentAgentId = agent.id;
  viewManager.navigateToView('agents/AgentChatView');
}
