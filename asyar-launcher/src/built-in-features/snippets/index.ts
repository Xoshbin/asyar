import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
// @ts-ignore
import DefaultView from './DefaultView.svelte';
import { snippetService } from './snippetService';
import { ActionContext } from 'asyar-sdk';
import { actionService } from '../../services/action/actionService';
import { snippetEditorTrigger } from './snippetUiState';

class SnippetsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');
  }

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open-snippets') {
      this.extensionManager?.navigateToView('snippets/DefaultView');
      return { type: 'view', viewPath: 'snippets/DefaultView' };
    }
  }

  async viewActivated(_viewId: string): Promise<void> {
    const result = await snippetService.onViewOpen();
    actionService.registerAction({
        id: 'snippets:add',
        label: 'Add Snippet',
        icon: '➕',
        description: 'Create a new text expansion snippet',
        category: 'Snippets',
        extensionId: 'snippets',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => { snippetEditorTrigger.set('add'); },
    });
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    actionService.unregisterAction('snippets:add');
  }
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new SnippetsExtension();
export { DefaultView };
