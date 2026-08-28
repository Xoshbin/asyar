import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk/contracts';
import { ActionContext } from 'asyar-sdk/contracts';
import type { ExtensionAction, FileHit } from 'asyar-sdk/contracts';
import { tick } from 'svelte';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { writeText } from 'tauri-plugin-clipboard-x-api';
import { actionService } from '../../services/action/actionService.svelte';
import { fileManagerService } from '../../services/fileManager/fileManagerService';
import { searchStores } from '../../services/search/stores/search.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { logService } from '../../services/log/logService';
import {
  openInTerminal,
  quickLookPath,
  fileSearchClearHistory,
} from '../../lib/ipc/fileSearchCommands';
import {
  fileSearchViewState,
  getSelectedFile,
  loadPinnedFiles,
  runSearch,
  runDeepSearch,
  checkDeepSearchAvailability,
  recordSelectionForCurrentQuery,
  togglePin,
} from './state.svelte';
import { primeAiChipForFile } from './aiChipBridge';
// @ts-ignore
import DefaultView from './DefaultView.svelte';

function parentDirOf(f: FileHit): string {
  return f.isDir ? f.path : f.path.replace(/\/[^/]*$/, '');
}

class FileSearchExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView: boolean = false;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');

    await loadPinnedFiles();
    await checkDeepSearchAvailability();

    // Wire executor for the manifest-declared "clear-history" action only.
    // The host registered this action from manifest.json before initialize()
    // was called. setActionExecutor patches only the execute field.
    actionService.setActionExecutor('act_file-search_clear-history', async () => {
      await fileSearchClearHistory();
    });
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
    logService.debug(`[FileSearch] view activated: ${viewPath}`);
    if (typeof window !== 'undefined') {
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
      await openPath(selected.path);
      return;
    }

    // Space = Quick Look
    if (event.key === ' ') {
      const selected = getSelectedFile();
      if (!selected) return;
      event.preventDefault();
      event.stopPropagation();
      const ok = await quickLookPath(selected.path);
      if (!ok) await openPath(selected.path);
    }
  }

  private registerViewActions(): void {
    const actions: ExtensionAction[] = [
      {
        id: 'file-search:reveal-in-finder',
        title: 'Reveal in Finder',
        description: 'Show the file in Finder',
        icon: 'icon:folder',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Super+R',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await revealItemInDir(f.path);
        },
      },
      {
        id: 'file-search:copy-path',
        title: 'Copy Path',
        description: 'Copy the absolute file path',
        icon: 'icon:clipboard',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Super+Shift+C',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await writeText(f.path);
        },
      },
      {
        id: 'file-search:copy-name',
        title: 'Copy Name',
        description: 'Copy the filename only',
        icon: 'icon:clipboard',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Super+Alt+C',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await writeText(f.name);
        },
      },
      {
        id: 'file-search:open-in-terminal',
        title: 'Open in Terminal',
        description: 'Open the containing folder in the default terminal',
        icon: 'icon:terminal',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Super+T',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await openInTerminal(parentDirOf(f));
        },
      },
      {
        id: 'file-search:toggle-pin',
        title: 'Toggle Pin',
        description: 'Pin this file to the top or unpin it',
        icon: 'icon:bookmark',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Super+P',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await togglePin(f.fileId, f.path);
        },
      },
      {
        id: 'file-search:move-to-trash',
        title: 'Move to Trash',
        description: 'Move the file to the system trash',
        icon: 'icon:trash',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        destructive: true,
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          try {
            await fileManagerService.trash(f.path);
            fileSearchViewState.results = fileSearchViewState.results.filter(
              (r) => r.fileId !== f.fileId,
            );
            fileSearchViewState.deepResults = fileSearchViewState.deepResults.filter(
              (r) => r.fileId !== f.fileId,
            );
          } catch (err) {
            feedbackService.report({
              source: 'frontend',
              kind: 'file-search/trash-failed',
              severity: 'error',
              retryable: false,
              developerDetail: String(err),
            });
          }
        },
      },
      {
        id: 'file-search:quick-look',
        title: 'Quick Look',
        description: 'Preview the file',
        icon: 'icon:eye',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          const ok = await quickLookPath(f.path);
          if (!ok) await openPath(f.path);
        },
      },
      {
        id: 'file-search:send-to-ai',
        title: 'Send to Asyar AI',
        description: 'Open AI chat with this file as context',
        icon: 'icon:sparkles',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Super+I',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await primeAiChipForFile(f);
        },
      },
      {
        id: 'file-search:deep-search',
        title: 'Search Everywhere',
        description:
          'Run an OS-native deep search (Spotlight/Everything/plocate) for the current query',
        icon: 'icon:globe',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Super+Shift+F',
        execute: async () => {
          await runDeepSearch();
        },
      },
    ];

    for (const action of actions) {
      actionService.registerAction(action);
    }
  }

  private unregisterViewActions(): void {
    actionService.unregisterAction('file-search:reveal-in-finder');
    actionService.unregisterAction('file-search:copy-path');
    actionService.unregisterAction('file-search:copy-name');
    actionService.unregisterAction('file-search:open-in-terminal');
    actionService.unregisterAction('file-search:toggle-pin');
    actionService.unregisterAction('file-search:move-to-trash');
    actionService.unregisterAction('file-search:quick-look');
    actionService.unregisterAction('file-search:send-to-ai');
    actionService.unregisterAction('file-search:deep-search');
  }

  async viewDeactivated(viewPath: string): Promise<void> {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
    }
    this.unregisterViewActions();
    this.inView = false;
    logService.debug(`[FileSearch] view deactivated: ${viewPath}`);
  }

  async onViewSearch(query: string): Promise<void> {
    fileSearchViewState.searchQuery = query;
  }

  async activate(): Promise<void> {}

  async deactivate(): Promise<void> {
    if (this.inView) {
      this.unregisterViewActions();
    }
  }
}

export default new FileSearchExtension();
export { DefaultView };
