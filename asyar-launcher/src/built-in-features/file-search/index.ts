import { revealItemInDir } from '@tauri-apps/plugin-opener';
import type {
  Extension,
  ExtensionAction,
  ExtensionContext,
  FileHit,
  IExtensionManager,
} from 'asyar-sdk/contracts';
import { ActionContext } from 'asyar-sdk/contracts';
import { tick } from 'svelte';
import { writeText } from 'tauri-plugin-clipboard-x-api';
import {
  fileSearchClearHistory,
  openInTerminal,
  quickLookPath,
} from '../../lib/ipc/fileSearchCommands';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { fileManagerService } from '../../services/fileManager/fileManagerService';
import { t } from '../../services/i18n';
import { logService } from '../../services/log/logService';
import { openerService } from '../../services/opener/openerService';
import { searchStores } from '../../services/search/stores/search.svelte';
import { primeAiChipForFile } from './aiChipBridge';
import {
  checkDeepSearchAvailability,
  fileSearchViewState,
  getSelectedFile,
  loadPinnedFiles,
  recordSelectionForCurrentQuery,
  runDeepSearch,
  runSearch,
  togglePin,
} from './state.svelte';
// @ts-ignore
import DefaultView from './DefaultView.svelte';
import manifest from './manifest.json';
import { registerBuiltinDynamicDispatcher } from '../../services/extension/builtinDynamicDispatchers';
import { registerBuiltinSearchProvider } from '../../services/search/builtinSearchProviders';
import {
  currentPathRowTarget,
  OPEN_PATH_ROW_ID,
  openTarget,
  openTypedPath,
  openTypedUrl,
  searchOpenTargets,
  type OpenTarget,
} from './openTarget';

function argText(args: Record<string, unknown> | undefined, name: string): string {
  const value = (args?.arguments as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}

function parentDirOf(f: FileHit): string {
  return f.isDir ? f.path : f.path.replace(/\/[^/]*$/, '');
}

const showFiles = manifest.commands.find((c) => c.id === 'show-files')!;
const SHOW_FILES_NAMES = [showFiles.name, showFiles.trigger ?? '']
  .map((n) => n.toLowerCase())
  .filter(Boolean);

/** True when `query` is a prefix of the command's name, any of its words, or its keyword. */
export function isShowFilesName(query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return true;
  // ponytail: prefix check only; user aliases still seed. Use the ranker's tier if that matters.
  return SHOW_FILES_NAMES.some((n) => n.startsWith(q) || n.split(' ').some((w) => w.startsWith(q)));
}

const SHOW_IN_SEARCH_ACTION_ID = 'file-search:show-in-search';

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
    // Root-search text seeds the view, unless it was just the command's own
    // name ("sear", "files") used to find it.
    if (commandId === 'show-files') {
      const query = typeof args?.query === 'string' ? args.query : '';
      return this.openView(isShowFilesName(query) ? '' : query);
    }
    if (commandId === 'open-url') {
      await openTypedUrl(argText(args, 'url'));
      return { type: 'no-view' };
    }
    if (commandId === 'open-path') {
      await openTypedPath(argText(args, 'path'));
      return { type: 'no-view' };
    }
    return undefined;
  }

  async openView(
    seedQuery: string,
    selectPath?: string,
  ): Promise<{ type: 'view'; viewPath: string }> {
    this.extensionManager?.navigateToView('file-search/DefaultView');
    this.registerViewActions();
    if (seedQuery) {
      await tick();
      // Also push into the shared search bar (not just the view's own
      // internal query) — otherwise the visible bar keeps showing
      // whatever the user typed in root search while the view silently
      // searches a different query underneath it.
      searchStores.query = seedQuery;
      fileSearchViewState.searchQuery = seedQuery;
      await runSearch();
      const hit = selectPath && fileSearchViewState.allItems.find((f) => f.path === selectPath);
      if (hit) fileSearchViewState.selectedFileId = hit.fileId;
    }
    return { type: 'view', viewPath: 'file-search/DefaultView' };
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
    const actions: ExtensionAction[] = [
      {
        id: 'file-search:reveal-in-finder',
        title: t('features.file_search.act.reveal'),
        description: t('features.file_search.act.reveal_desc'),
        icon: 'icon:folder',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+R',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await revealItemInDir(f.path);
        },
      },
      {
        id: 'file-search:copy-path',
        title: t('features.file_search.act.copy_path'),
        description: t('features.file_search.act.copy_path_desc'),
        icon: 'icon:clipboard',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Shift+C',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await writeText(f.path);
        },
      },
      {
        id: 'file-search:copy-name',
        title: t('features.file_search.act.copy_name'),
        description: t('features.file_search.act.copy_name_desc'),
        icon: 'icon:clipboard',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Alt+C',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await writeText(f.name);
        },
      },
      {
        id: 'file-search:open-in-terminal',
        title: t('features.file_search.act.open_terminal'),
        description: t('features.file_search.act.open_terminal_desc'),
        icon: 'icon:terminal',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+T',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await openInTerminal(parentDirOf(f));
        },
      },
      {
        id: 'file-search:toggle-pin',
        title: t('features.file_search.act.toggle_pin'),
        description: t('features.file_search.act.toggle_pin_desc'),
        icon: 'icon:bookmark',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Shift+P',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await togglePin(f.fileId, f.path);
        },
      },
      {
        id: 'file-search:move-to-trash',
        title: t('features.file_search.act.trash'),
        description: t('features.file_search.act.trash_desc'),
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
        title: t('features.file_search.act.quick_look'),
        description: t('features.file_search.act.quick_look_desc'),
        icon: 'icon:eye',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          const ok = await quickLookPath(f.path);
          if (!ok) await openerService.openPath(null, f.path);
        },
      },
      {
        id: 'file-search:send-to-ai',
        title: t('features.file_search.act.send_ai'),
        description: t('features.file_search.act.send_ai_desc'),
        icon: 'icon:sparkles',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+I',
        execute: async () => {
          const f = getSelectedFile();
          if (!f) return;
          await primeAiChipForFile(f);
        },
      },
      {
        id: 'file-search:clear-history',
        title: t('features.file_search.act.clear_history'),
        description: t('features.file_search.act.clear_history_desc'),
        icon: 'icon:trash',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        destructive: true,
        execute: async () => {
          await fileSearchClearHistory();
        },
      },
      {
        id: 'file-search:deep-search',
        title: t('features.file_search.act.search_everywhere'),
        description: t('features.file_search.act.search_everywhere_desc'),
        icon: 'icon:globe',
        extensionId: 'file-search',
        category: 'file-action',
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Shift+F',
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
    actionService.unregisterAction('file-search:clear-history');
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
    // ⌘K on a typed-path row in root search ("~/coding") → this view.
    actionService.registerAction({
      id: SHOW_IN_SEARCH_ACTION_ID,
      label: t('features.file_search.act.show_in_search'),
      description: t('features.file_search.act.show_in_search_desc'),
      icon: 'icon:folder-search',
      // No extensionId: leaving the File Search view clears every action
      // tagged 'file-search', and this one belongs to root search.
      category: 'file-action',
      context: ActionContext.CORE,
      pinned: true,
      visible: () =>
        actionService.getSelectedSearchItem()?.objectId === OPEN_PATH_ROW_ID &&
        currentPathRowTarget() !== null,
      execute: async () => {
        const path = currentPathRowTarget();
        if (!path) return;
        // ponytail: seeds by name, so a file outside the index opens an empty
        // search; inject a synthetic hit if that turns out to matter.
        const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
        await this.openView(name, path);
      },
    });
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
    actionService.unregisterAction(SHOW_IN_SEARCH_ACTION_ID);
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

// Typed URLs and paths in root search open directly (Raycast-style).
registerBuiltinSearchProvider({
  extensionId: 'file-search',
  search: searchOpenTargets,
  execute: (_id, payload) => openTarget(payload as OpenTarget),
});

const extension = new FileSearchExtension();

// Rust's "Search files for “…”…" fallback row (`cmd_file-search_dyn_search-for`).
registerBuiltinDynamicDispatcher('file-search', async (dynamicId, args) => {
  if (dynamicId !== 'search-for') return;
  return extension.openView(typeof args?.query === 'string' ? args.query : '');
});

export default extension;
export { DefaultView };
