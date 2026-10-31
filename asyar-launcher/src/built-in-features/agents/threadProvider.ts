import { agentsManager } from './agentsManager.svelte';
import { agentService } from './agentService.svelte';
import { ensureThread } from './agentChatView.helpers';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { t } from '../../services/i18n';
import type { ModelRef } from './modelCatalog.svelte';

/**
 * Point the active thread at `target`, or back at its agent with `null`. Only
 * this thread changes; the agent and the Settings default stay as they are.
 * With no thread yet, one is started so the choice applies to the first
 * message. Failures are reported, never thrown.
 */
export async function setActiveThreadModel(target: ModelRef | null): Promise<boolean> {
  const agentId = agentsManager.currentAgentId;
  if (!agentId) return false;
  const providerId = target?.providerId ?? null;
  const modelId = target?.modelId ?? null;
  try {
    let threadId = agentsManager.currentThreadId;
    if (!threadId) {
      threadId = (await ensureThread(agentId, { service: agentService })).id;
      if (agentsManager.currentAgentId !== agentId) return false;
      agentsManager.currentThreadId = threadId;
    }
    await agentService.setThreadProvider(threadId, providerId, modelId);
    const known = agentsManager.threadsFor(agentId);
    if (known) {
      agentsManager.rememberThreads(
        agentId,
        known.map((th) => (th.id === threadId ? { ...th, providerId, modelId } : th)),
      );
    }
    agentsManager.threadsVersion += 1;
    return true;
  } catch (err) {
    feedbackService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'error',
      retryable: true,
      context: { message: t('features.agents.error_set_thread_provider') },
      developerDetail: String(err),
    });
    return false;
  }
}
