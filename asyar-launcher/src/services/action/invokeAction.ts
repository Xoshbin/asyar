import { t } from '../i18n';
import { logService } from '../log/logService';
import { feedbackService } from '../feedback/feedbackService.svelte';
import { actionService } from './actionService.svelte';

/**
 * Runs an action the way a user-initiated invocation should: behind its
 * confirm dialog when it has one, with success/failure surfaced through
 * `feedbackService`. The ⌘K panel and the shortcut dispatcher both call this,
 * so picking an action in the list and pressing its key behave identically.
 */
export async function invokeAction(action: {
  id: string;
  label: string;
  confirm?: boolean;
}): Promise<void> {
  if (action.confirm) {
    const confirmed = await feedbackService.confirmAlert({
      title: t('dialogs.confirm.title'),
      message: t('launcher_errors.confirm_run', { label: action.label }),
      confirmText: t('common.confirm'),
      variant: 'danger',
    });
    if (!confirmed) return;
  }

  try {
    await actionService.executeAction(action.id);
    await feedbackService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'success',
      retryable: false,
      context: { message: action.label },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logService.error(`[invokeAction] Failed to execute action ${action.id}: ${error}`);
    await feedbackService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'error',
      retryable: false,
      context: { message: t('launcher_errors.action_failed', { message: msg }) },
    });
  }
}
