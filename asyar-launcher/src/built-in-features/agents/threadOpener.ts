import { agentsManager } from './agentsManager.svelte';
import { agentService } from './agentService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
type SubmitHandler = (query: string) => Promise<void>;
let submitHandler: SubmitHandler | null = null;

export function registerAgentSubmitHandler(handler: SubmitHandler): void {
  submitHandler = handler;
}

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

  if (initialQuery && submitHandler) {
    await submitHandler(initialQuery);
  }
}
