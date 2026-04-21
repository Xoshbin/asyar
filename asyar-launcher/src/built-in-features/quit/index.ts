import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { quitApp, setFocusLock } from '../../lib/ipc/commands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';

class QuitExtension implements Extension {
  onUnload = () => {};

  async initialize(_context: ExtensionContext): Promise<void> {}

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'quit-asyar') {
      // Lock focus so the launcher doesn't dismiss while the dialog is open
      await setFocusLock(true);
      try {
        const confirmed = await feedbackService.confirmAlert({
          title: 'Quit Asyar',
          message: 'Are you sure you want to quit Asyar?',
          confirmText: 'Quit',
          cancelText: 'Cancel',
          variant: 'danger',
        });

        if (confirmed) {
          await quitApp();
        }
      } finally {
        await setFocusLock(false);
      }
      // User cancelled — return nothing so the launcher stays visible
      return undefined;
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new QuitExtension();
