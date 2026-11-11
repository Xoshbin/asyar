import { t } from '../../services/i18n';
import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk/contracts';
// @ts-ignore
import DefaultView from './DefaultView.svelte';
import SnippetFormView from './SnippetFormView.svelte';
import { snippetStore } from './snippetStore.svelte';
import { snippetService } from './snippetService';
import { ActionContext } from 'asyar-sdk/contracts';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { snippetUiState } from './snippetUiState.svelte';
import { snippetViewState } from './snippetViewState.svelte';
import { writeText } from 'tauri-plugin-clipboard-x-api';
import { isAnyModalOpen } from '../../components/base/Modal.logic';

class SnippetsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView = false;
  private activationGeneration = 0;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');
  }

  private async handleKeydown(e: KeyboardEvent) {
    if (!this.inView) return;
    if (typeof document !== 'undefined') {
      if (document.querySelector('.action-popup') || isAnyModalOpen(document)) return;
    }
    if (snippetViewState.mode !== 'view') return; // let form handle its own keys

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      snippetViewState.moveSelection(e.key === 'ArrowUp' ? 'up' : 'down');
    }
  }

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open-snippets') {
      this.extensionManager?.navigateToView('snippets/DefaultView');
      return { type: 'view', viewPath: 'snippets/DefaultView' };
    }
  }

  private registerViewActions(): void {
    actionService.registerAction({
      id: 'snippets:add',
      label: t('features.snippets.act.add'),
      icon: 'icon:plus',
      shortcut: 'Mod+N',
      description: t('features.snippets.act.add_desc'),
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        snippetViewState.startCreate();
        viewManager.navigateToView('snippets/SnippetFormView', { searchable: false });
      },
    });
    actionService.registerAction({
      id: 'snippets:paste',
      label: t('features.snippets.act.paste'),
      icon: 'icon:keyboard',
      shortcut: 'Enter',
      primary: true,
      description: t('features.snippets.act.paste_desc'),
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      visible: () => Boolean(snippetViewState.selectedSnippet),
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (s) await snippetService.pasteSnippet(s.expansion);
      },
    });
    actionService.registerAction({
      id: 'snippets:create-empty',
      label: t('features.snippets.ui.add_first'),
      icon: 'icon:plus',
      shortcut: 'Enter',
      primary: true,
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      visible: () => snippetViewState.getFilteredSnippets().length === 0,
      execute: async () => {
        snippetViewState.startCreate();
        viewManager.navigateToView('snippets/SnippetFormView', { searchable: false });
      },
    });
    actionService.registerAction({
      id: 'snippets:edit',
      label: t('features.snippets.act.edit'),
      icon: 'icon:pencil',
      shortcut: 'Mod+E',
      description: t('features.snippets.act.edit_desc'),
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      visible: () => Boolean(snippetViewState.selectedSnippet),
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (s) {
          snippetViewState.startEdit(s);
          viewManager.navigateToView('snippets/SnippetFormView', { searchable: false });
        }
      },
    });
    actionService.registerAction({
      id: 'snippets:delete',
      label: t('features.snippets.act.delete'),
      icon: 'icon:trash',
      shortcut: 'Control+X',
      description: t('features.snippets.act.delete_desc'),
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      confirm: true,
      destructive: true,
      visible: () => Boolean(snippetViewState.selectedSnippet),
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (s) {
          snippetStore.remove(s.id);
          await snippetService.syncToRust();
        }
      },
    });
    actionService.registerAction({
      id: 'snippets:copy-expansion',
      label: t('features.snippets.act.copy'),
      icon: 'icon:copy',
      shortcut: 'Mod+Shift+C',
      description: t('features.snippets.act.copy_desc'),
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      visible: () => Boolean(snippetViewState.selectedSnippet),
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (s) await writeText(s.expansion);
      },
    });
    actionService.registerAction({
      id: 'snippets:duplicate',
      label: t('features.snippets.act.duplicate'),
      icon: 'icon:layers',
      shortcut: 'Mod+D',
      description: t('features.snippets.act.duplicate_desc'),
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      visible: () => Boolean(snippetViewState.selectedSnippet),
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (!s) return;
        const newId = crypto.randomUUID();
        let newKeyword = s.keyword + '-copy';
        const existing = snippetStore.getAll().map((x) => x.keyword);
        let i = 2;
        while (existing.includes(newKeyword)) {
          newKeyword = s.keyword + `-copy${i}`;
          i++;
        }
        const dup = {
          id: newId,
          name: s.name + ' Copy',
          keyword: newKeyword,
          expansion: s.expansion,
          createdAt: Date.now(),
        };
        snippetStore.add(dup);
        await snippetService.syncToRust();
      },
    });
    actionService.registerAction({
      id: 'snippets:pin',
      label: t('features.snippets.act.pin_snippet'),
      icon: 'icon:pin',
      shortcut: 'Mod+.',
      description: t('features.snippets.act.pin_desc'),
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      visible: () =>
        snippetViewState.selectedSnippet ? !snippetViewState.selectedSnippet.pinned : false,
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (s) {
          snippetStore.togglePin(s.id);
          await snippetService.syncToRust();
        }
      },
    });
    actionService.registerAction({
      id: 'snippets:unpin',
      label: t('features.snippets.act.unpin_snippet'),
      icon: 'icon:pin',
      shortcut: 'Mod+.',
      description: t('features.snippets.act.pin_desc'),
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      visible: () =>
        snippetViewState.selectedSnippet ? Boolean(snippetViewState.selectedSnippet.pinned) : false,
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (s) {
          snippetStore.togglePin(s.id);
          await snippetService.syncToRust();
        }
      },
    });
    actionService.registerAction({
      id: 'snippets:toggle-private',
      label: t('features.snippets.act.private'),
      icon: 'icon:lock',
      description: t('features.snippets.act.private_desc'),
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      visible: () => Boolean(snippetViewState.selectedSnippet),
      execute: async () => {
        const s = snippetViewState.selectedSnippet;
        if (s) {
          snippetStore.togglePrivate(s.id);
          await snippetService.syncToRust();
        }
      },
    });
    actionService.registerAction({
      id: 'snippets:clear-all',
      label: t('features.snippets.act.clear_all'),
      icon: 'icon:trash',
      shortcut: 'Control+Shift+X',
      description: t('features.snippets.act.clear_all_desc'),
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      confirm: true,
      destructive: true,
      visible: () => snippetStore.getAll().length > 0,
      execute: async () => {
        snippetStore.clearAll();
        await snippetService.syncToRust();
        snippetViewState.reset();
      },
    });
  }

  private unregisterViewActions(): void {
    actionService.unregisterAction('snippets:add');
    actionService.unregisterAction('snippets:paste');
    actionService.unregisterAction('snippets:create-empty');
    actionService.unregisterAction('snippets:edit');
    actionService.unregisterAction('snippets:delete');
    actionService.unregisterAction('snippets:copy-expansion');
    actionService.unregisterAction('snippets:duplicate');
    actionService.unregisterAction('snippets:pin');
    actionService.unregisterAction('snippets:unpin');
    actionService.unregisterAction('snippets:toggle-private');
    actionService.unregisterAction('snippets:clear-all');
  }

  async viewActivated(viewId: string): Promise<void> {
    const generation = ++this.activationGeneration;
    if (viewId !== 'snippets/DefaultView') return;
    this.inView = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound, true);
      window.addEventListener('keydown', this.handleKeydownBound, true);
    }
    await snippetService.onViewOpen();
    if (
      generation !== this.activationGeneration ||
      !this.inView ||
      viewManager.activeView !== 'snippets/DefaultView'
    )
      return;
    this.registerViewActions();
  }

  async viewDeactivated(viewId: string): Promise<void> {
    ++this.activationGeneration;
    this.inView = false;
    if (viewId === 'snippets/SnippetFormView') {
      snippetUiState.prefillExpansion = null;
      snippetViewState.cancelEdit();
      return;
    }
    this.inView = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound, true);
    }
    if (!viewManager.isViewInStack('snippets/DefaultView')) {
      snippetViewState.reset();
    }
    this.unregisterViewActions();
  }

  async onViewSearch(query: string): Promise<void> {
    await snippetViewState.setSearch(query);
  }

  async activate(): Promise<void> {
    await snippetStore.reload();
  }

  async deactivate(): Promise<void> {
    ++this.activationGeneration;
    this.inView = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound, true);
    }
    snippetUiState.prefillExpansion = null;
    snippetViewState.reset();
    this.unregisterViewActions();
  }
}

export default new SnippetsExtension();
export { DefaultView, SnippetFormView };
