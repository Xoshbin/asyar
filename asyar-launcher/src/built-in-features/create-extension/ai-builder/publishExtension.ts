import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
import { openTerminalAt } from './openTerminal';

export const PUBLISH_COMMAND = 'pnpm exec asyar publish';

export async function publishExtension(path: string): Promise<void> {
  const ok = await feedbackService.confirmAlert({
    title: 'Publish to Asyar Store',
    message:
      'This builds the extension, creates a PUBLIC GitHub repository, pushes the code, ' +
      'and submits it to the Asyar Store for review. Continue?',
    confirmText: 'Publish',
    cancelText: 'Cancel',
  });
  if (!ok) return;
  await openTerminalAt(path, PUBLISH_COMMAND);
}
