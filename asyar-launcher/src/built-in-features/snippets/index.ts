import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
// @ts-ignore
import DefaultView from './DefaultView.svelte';
import { snippetService } from './snippetService';
import { ActionContext } from 'asyar-sdk';
import { actionService } from '../../services/action/actionService.svelte';
import { snippetUiState } from './snippetUiState.svelte';
import { snippetViewState } from './snippetViewState.svelte';

class SnippetsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView = false;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');
  }

  private handleKeydown(e: KeyboardEvent) {
    if (!this.inView) return;
    if (snippetViewState.mode !== 'view') return; // let form handle its own keys

    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      snippetViewState.startCreate();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      snippetViewState.moveSelection(e.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace') {
      e.preventDefault();
      snippetViewState.triggerDelete();
    }
  }

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open-snippets') {
      this.extensionManager?.navigateToView('snippets/DefaultView');
      return { type: 'view', viewPath: 'snippets/DefaultView' };
    }
  }

  async viewActivated(_viewId: string): Promise<void> {
    this.inView = true;
    window.addEventListener('keydown', this.handleKeydownBound);
    const result = await snippetService.onViewOpen();
    actionService.registerAction({
        id: 'snippets:add',
        label: 'Add Snippet',
        icon: '➕',
        description: 'Create a new text expansion snippet',
        category: 'Snippets',
        extensionId: 'snippets',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => { snippetViewState.startCreate(); },
    });
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    this.inView = false;
    window.removeEventListener('keydown', this.handleKeydownBound);
    snippetViewState.reset();
    actionService.unregisterAction('snippets:add');
  }

  async onViewSearch(query: string): Promise<void> {
    snippetViewState.setSearch(query);
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new SnippetsExtension();
export { DefaultView };
