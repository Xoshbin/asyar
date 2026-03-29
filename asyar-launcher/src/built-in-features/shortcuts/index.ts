import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
import { ActionContext } from 'asyar-sdk';
// @ts-ignore
import DefaultView from './DefaultView.svelte';
import { actionService } from '../../services/action/actionService.svelte';

class ShortcutsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');
  }

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open-shortcuts') {
      this.extensionManager?.navigateToView('shortcuts/DefaultView');
      return { type: 'view', viewPath: 'shortcuts/DefaultView' };
    }
  }

  async viewActivated(_viewId: string): Promise<void> {
    this.registerViewActions();
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    this.unregisterViewActions();
  }

  private registerViewActions() {
    actionService.registerAction({
      id: 'shortcuts:find-item',
      label: 'Assign Shortcut',
      icon: '⌨️',
      description: 'Go back to search, select any result, then press ⌘K → Assign Shortcut',
      category: 'Shortcuts',
      extensionId: 'shortcuts',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        this.extensionManager?.goBack();
      },
    });
  }

  private unregisterViewActions() {
    actionService.unregisterAction('shortcuts:find-item');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {
    this.unregisterViewActions();
  }
}

export default new ShortcutsExtension();
export { DefaultView };
