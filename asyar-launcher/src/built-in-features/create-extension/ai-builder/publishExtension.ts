import { t } from '../../../services/i18n';
import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
import { openTerminalAt } from './openTerminal';

export const PUBLISH_COMMAND = 'pnpm exec asyar publish';

export async function publishExtension(path: string): Promise<void> {
  const ok = await feedbackService.confirmAlert({
    title: t('features.create_extension.ai.publish_title'),
    message: t('features.create_extension.ai.publish_message'),
    confirmText: t('features.create_extension.ai.publish_confirm'),
    cancelText: t('common.cancel'),
  });
  if (!ok) return;
  await openTerminalAt(path, PUBLISH_COMMAND);
}
