import { agentsFindRunOrigin } from '../../lib/ipc/commands';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { logService } from '../../services/log/logService';
import { agentsManager } from './agentsManager.svelte';

export async function openAgentRunInChat(runId: string): Promise<boolean> {
  try {
    const origin = await agentsFindRunOrigin(runId);
    if (!origin) {
      logService.warn(`[agents] no thread found for run ${runId}`);
      return false;
    }

    agentsManager.currentAgentId = origin.agentId;
    agentsManager.currentThreadId = origin.threadId;
    viewManager.navigateToView('agents/AgentChatView');
    return true;
  } catch (error) {
    logService.warn(`[agents] open-run-in-chat failed: ${error}`);
    return false;
  }
}
