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
  agentsManager.currentThreadId = null;

  // Navigation must stay synchronous with the context-mode activation. Compact
  // mode expands as soon as that context is committed, so awaiting persistence
  // first would paint one expanded root-launcher frame before this view appears.
  viewManager.navigateToView('agents/AgentChatView');

  if (!agentId) {
    return;
  }

  if (continueLastThread) {
    const threads = await agentService.listThreads(agentId);
    if (agentsManager.currentAgentId !== agentId) return;
    agentsManager.currentThreadId = threads.length > 0 ? threads[0].id : null;
  }

  if (initialQuery && submitHandler) {
    await submitHandler(initialQuery);
  }
}
