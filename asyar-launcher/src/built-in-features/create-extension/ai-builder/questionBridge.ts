import { buildJobStore, type PendingQuestion } from './buildJobStore.svelte';
import { sidecarClient } from './sidecarClient';
import { notificationService } from '../../../services/notification/notificationService';

/**
 * The built-in extension ID for the extension builder (must match manifest.json).
 * Used as the callerExtensionId for system notifications so the action deep-link
 * resolves to: cmd_create-extension_build-with-ai.
 */
const CALLER_EXT_ID = 'create-extension';

/**
 * Stores the pending question in the build job store (status → 'waiting') and
 * fires a system notification whose action deep-links to the build view.
 * Clicking the notification action dispatches `cmd_create-extension_build-with-ai`
 * which navigates the user back into the AI builder view.
 */
export async function presentQuestion(q: PendingQuestion): Promise<void> {
  buildJobStore.setQuestion(q);
  await notificationService.send(CALLER_EXT_ID, {
    title: 'AI Builder needs input',
    body: q.prompt,
    actions: [
      {
        id: 'open-builder',
        title: 'Answer',
        commandId: 'build-with-ai',
        args: { buildId: 'current' },
      },
    ],
  });
}

/**
 * Writes the user's answer to the sidecar stdin and clears the pending question
 * (status → 'working'). No-ops when there is no pending question.
 */
export async function submitAnswer(value: string): Promise<void> {
  const q = buildJobStore.job?.pendingQuestion;
  if (!q) return;
  await sidecarClient.send({ kind: 'answer', questionId: q.questionId, value });
  buildJobStore.clearQuestion();
}
