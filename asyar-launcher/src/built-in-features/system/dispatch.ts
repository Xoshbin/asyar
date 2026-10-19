import { platform } from '@tauri-apps/plugin-os';
import type { SystemActionId } from '../../lib/ipc/commands';
import { hideWindow, setFocusLock, showWindow, systemActionRun } from '../../lib/ipc/commands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { logService } from '../../services/log/logService';
import type { BuiltinDispatchResult } from '../../services/extension/builtinDynamicDispatchers';
import { systemActionSpecs } from './actions';

/**
 * Executes a system dynamic command. Destructive actions (log out,
 * restart, shut down) confirm first — same focus-lock idiom as the Quit
 * feature, so the launcher doesn't dismiss while the dialog is open.
 * The launcher window hides before the action fires; if the action
 * fails it is shown again and `keep-open` tells the manager not to re-hide it.
 */
export async function dispatchSystemCommand(
  dynamicId: string,
): Promise<void | BuiltinDispatchResult> {
  const specs = systemActionSpecs(platform());
  const spec = specs[dynamicId as SystemActionId];
  if (!spec) {
    logService.warn(`[system] unknown system command: ${dynamicId}`);
    return;
  }

  if (spec.confirm) {
    await setFocusLock(true);
    try {
      const confirmed = await feedbackService.confirmAlert({
        title: spec.confirm.title,
        message: spec.confirm.message,
        confirmText: spec.confirm.confirmText,
        cancelText: 'Cancel',
        variant: 'danger',
      });
      if (!confirmed) {
        return;
      }
    } finally {
      await setFocusLock(false);
    }
  }

  await hideWindow();
  const succeeded = await systemActionRun(spec.id);
  if (!succeeded) {
    await showWindow();
    return { type: 'keep-open' };
  }
}
