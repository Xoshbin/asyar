import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
// @ts-ignore
import DefaultView from './DefaultView.svelte';
import { snippetStore } from './snippetStore.svelte';
import { snippetService } from './snippetService';
import { ActionContext } from 'asyar-sdk';
import { actionService } from '../../services/action/actionService.svelte';
import { snippetUiState } from './snippetUiState.svelte';
import { snippetViewState } from './snippetViewState.svelte';
import { writeText } from 'tauri-plugin-clipboard-x-api';

class SnippetsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView = false;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');
  }

  private async handleKeydown(e: KeyboardEvent) {
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
      return;
    }
    if (e.key === 'Enter' && snippetViewState.selectedSnippet) {
      e.preventDefault();
      await snippetService.pasteSnippet(snippetViewState.selectedSnippet.expansion);
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
    this.extensionManager?.setActiveViewActionLabel('Paste');
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
    actionService.registerAction({
      id: 'snippets:paste',
      label: 'Paste Snippet',
      icon: '⌨️',
      description: 'Paste the selected snippet expansion into the active application',
      category: 'Snippets',
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (s) await snippetService.pasteSnippet(s.expansion);
      },
    });
    actionService.registerAction({
      id: 'snippets:edit',
      label: 'Edit Snippet',
      icon: '✏️',
      description: 'Edit the selected snippet',
      category: 'Snippets',
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (s) snippetViewState.startEdit(s);
      },
    });
    actionService.registerAction({
      id: 'snippets:delete',
      label: 'Delete Snippet',
      icon: '🗑️',
      description: 'Delete the selected snippet',
      category: 'Snippets',
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        snippetViewState.triggerDelete();
      },
    });
    actionService.registerAction({
      id: 'snippets:copy-expansion',
      label: 'Copy Expansion',
      icon: '📋',
      description: 'Copy the snippet expansion text to the clipboard',
      category: 'Snippets',
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (s) await writeText(s.expansion);
      },
    });
    actionService.registerAction({
      id: 'snippets:duplicate',
      label: 'Duplicate Snippet',
      icon: '⧉',
      description: 'Create a duplicate of the selected snippet',
      category: 'Snippets',
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (!s) return;
        const newId = crypto.randomUUID();
        let newKeyword = s.keyword + '-copy';
        const existing = snippetStore.getAll().map(x => x.keyword);
        let i = 2;
        while (existing.includes(newKeyword)) { newKeyword = s.keyword + `-copy${i}`; i++; }
        const dup = { id: newId, name: s.name + ' Copy', keyword: newKeyword, expansion: s.expansion, createdAt: Date.now() };
        snippetStore.add(dup);
        await snippetService.syncToRust();
      },
    });
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    this.inView = false;
    window.removeEventListener('keydown', this.handleKeydownBound);
    snippetViewState.reset();
    this.extensionManager?.setActiveViewActionLabel(null);
    actionService.unregisterAction('snippets:add');
    actionService.unregisterAction('snippets:paste');
    actionService.unregisterAction('snippets:edit');
    actionService.unregisterAction('snippets:delete');
    actionService.unregisterAction('snippets:copy-expansion');
    actionService.unregisterAction('snippets:duplicate');
  }

  async onViewSearch(query: string): Promise<void> {
    snippetViewState.setSearch(query);
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new SnippetsExtension();
export { DefaultView };
