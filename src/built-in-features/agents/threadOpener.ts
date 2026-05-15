import { agentsManager } from './agentsManager.svelte';
import { agentService } from './agentService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import agentsExtension from './index';

export async function openAgentForTab(
  agentId: string | null,
  initialQuery: string,
  continueLastThread: boolean,
): Promise<void> {
  agentsManager.currentAgentId = agentId;
  if (!agentId) {
    agentsManager.currentThreadId = null;
    viewManager.navigateToView('agents/AgentChatView');
    return;
  }

  if (continueLastThread) {
    const threads = await agentService.listThreads(agentId);
    agentsManager.currentThreadId = threads.length > 0 ? threads[0].id : null;
  } else {
    agentsManager.currentThreadId = null;
  }

  viewManager.navigateToView('agents/AgentChatView');

  if (initialQuery) {
    await agentsExtension.onViewSubmit(initialQuery);
  }
}
