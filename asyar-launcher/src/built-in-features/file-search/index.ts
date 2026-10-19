import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk/contracts';
import { ActionContext } from 'asyar-sdk/contracts';
import { tick } from 'svelte';
import { quickLookPath } from '../../lib/ipc/fileSearchCommands';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { t } from '../../services/i18n';
import { logService } from '../../services/log/logService';
import { openerService } from '../../services/opener/openerService';
import { searchStores } from '../../services/search/stores/search.svelte';
import { buildFileActions } from './fileActions';
import {
  checkDeepSearchAvailability,
  fileSearchViewState,
  getSelectedFile,
  loadPinnedFiles,
  recordSelectionForCurrentQuery,
  runSearch,
} from './state.svelte';
// @ts-ignore
import DefaultView from './DefaultView.svelte';

class FileSearchExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView: boolean = false;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');

    await loadPinnedFiles();
    await checkDeepSearchAvailability();
  }

  async executeCommand(commandId: string, args?: Record<string, unknown>): Promise<unknown> {
    if (commandId === 'show-files') {
      this.extensionManager?.navigateToView('file-search/DefaultView');
      this.registerViewActions();
      const seedQuery = typeof args?.query === 'string' ? args.query : '';
      if (seedQuery) {
        await tick();
        // Also push into the shared search bar (not just the view's own
        // internal query) — otherwise the visible bar keeps showing
        // whatever the user typed in root search while the view silently
        // searches a different query underneath it.
        searchStores.query = seedQuery;
        fileSearchViewState.searchQuery = seedQuery;
        await runSearch();
      }
      return { type: 'view', viewPath: 'file-search/DefaultView' };
    }
    return undefined;
  }

  async viewActivated(viewPath: string): Promise<void> {
    this.inView = true;
    // Claim the bottom-bar primary action for the view's duration: a
    // selected file's Enter opens it with the system default app, so the
    // hint must read "Open" — and registering it here also overrides the
    // stale root-search selection label that used to leak in as "Run".
    // Same pipeline ScriptLibraryView uses for its "Run Script" hint.
    viewManager.activeViewPrimaryActionLabel = t('actions.open');
    this.registerViewActions();
    logService.debug(`[FileSearch] view activated: ${viewPath}`);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
      window.addEventListener('keydown', this.handleKeydownBound);
    }
  }

  private handleKeydownBound = (event: KeyboardEvent) => this.handleKeydown(event);

  private async handleKeydown(event: KeyboardEvent): Promise<void> {
    if (!this.inView) return;
    if (!fileSearchViewState.allItems.length) return;

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      fileSearchViewState.moveSelection(event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }

    if (event.key === 'Enter') {
      const selected = getSelectedFile();
      if (!selected) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        await recordSelectionForCurrentQuery(selected.fileId);
      } catch (err) {
        logService.debug(`[FileSearch] recordSelectionForCurrentQuery failed: ${err}`);
      }
      await openerService.openPath(null, selected.path);
      return;
    }

    // Space = Quick Look
    if (event.key === ' ') {
      const selected = getSelectedFile();
      if (!selected) return;
      event.preventDefault();
      event.stopPropagation();
      const ok = await quickLookPath(selected.path);
      if (!ok) await openerService.openPath(null, selected.path);
    }
  }

  private registerViewActions(): void {
    const actions = buildFileActions({
      getFile: getSelectedFile,
      context: ActionContext.EXTENSION_VIEW,
      include: { deepSearch: true, clearHistory: true },
      onRemoved: (fileId) => {
        fileSearchViewState.results = fileSearchViewState.results.filter(
          (r) => r.fileId !== fileId,
        );
        fileSearchViewState.deepResults = fileSearchViewState.deepResults.filter(
          (r) => r.fileId !== fileId,
        );
      },
    });

    for (const action of actions) {
      actionService.registerAction(action);
    }
  }

  private unregisterViewActions(): void {
    for (const action of buildFileActions({
      getFile: getSelectedFile,
      context: ActionContext.EXTENSION_VIEW,
      include: { deepSearch: true, clearHistory: true },
    })) {
      actionService.unregisterAction(action.id);
    }
  }

  async viewDeactivated(viewPath: string): Promise<void> {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
    }
    this.unregisterViewActions();
    // Guarded clear, mirroring ScriptLibraryView: if another view claimed
    // the label in the interim, leave theirs alone.
    if (viewManager.activeViewPrimaryActionLabel === t('actions.open')) {
      viewManager.activeViewPrimaryActionLabel = null;
    }
    this.inView = false;
    logService.debug(`[FileSearch] view deactivated: ${viewPath}`);
  }

  async onViewSearch(query: string): Promise<void> {
    fileSearchViewState.searchQuery = query;
  }

  async activate(): Promise<void> {
    try {
      await loadPinnedFiles();
      await checkDeepSearchAvailability();
      logService.debug('[FileSearch] extension activated');
    } catch (error) {
      logService.error(`[FileSearch] failed to activate: ${error}`);
      throw error;
    }
  }

  async deactivate(): Promise<void> {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
    }
    this.unregisterViewActions();
    if (viewManager.activeViewPrimaryActionLabel === t('actions.open')) {
      viewManager.activeViewPrimaryActionLabel = null;
    }
    fileSearchViewState.reset();
    this.inView = false;
    logService.debug('[FileSearch] extension deactivated');
  }
}

export default new FileSearchExtension();
export { DefaultView };
