import { getCurrentAgentService } from './agentService.svelte';
import { agentsManager } from './agentsManager.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

export async function dispatchAgentCommand(
  dynamicId: string,
  _args?: unknown,
): Promise<void> {
  const service = getCurrentAgentService();
  const agent = service.getById(dynamicId);
  if (!agent) {
    throw new Error(`agent '${dynamicId}' not found`);
  }
  agentsManager.currentAgentId = agent.id;
  const threads = await service.listThreads(agent.id);
  agentsManager.currentThreadId = threads[0]?.id ?? null;
  viewManager.navigateToView('agents/AgentChatView');
}
