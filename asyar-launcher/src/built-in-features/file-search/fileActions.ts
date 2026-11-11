import type { ActionContext, ExtensionAction, FileHit } from 'asyar-sdk/contracts';
import { writeText } from 'tauri-plugin-clipboard-x-api';
import {
  fileSearchClearHistory,
  openInTerminal,
  quickLookPath,
} from '../../lib/ipc/fileSearchCommands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { fileManagerService } from '../../services/fileManager/fileManagerService';
import { t } from '../../services/i18n';
import { openerService } from '../../services/opener/openerService';
import { primeAiChipForFile } from './aiChipBridge';
import {
  fileSearchViewState,
  recordSelectionForCurrentQuery,
  runDeepSearch,
  togglePin,
} from './state.svelte';

type RootFile = {
  path?: string;
  name: string;
  fileId: string;
  isDir?: boolean;
  url?: string;
  extensionId?: string;
};

type ActionableFile = (FileHit | RootFile) & {
  url?: string;
  path?: string;
  extensionId?: string;
};

function asFileHit(file: ActionableFile): ActionableFile {
  if ('type' in file) return file;
  return {
    ...file,
    path: file.path ?? '',
    type: file.isDir ? 'folder' : 'other',
    isDir: file.isDir ?? false,
    modifiedAt: 0,
    score: 0,
    pinned: false,
    source: 'local',
  };
}

function parentDirOf(file: { isDir?: boolean; path?: string }): string {
  if (!file.path) return '';
  return file.isDir ? file.path : file.path.replace(/[/\\][^/\\]*$/, '');
}

export type FileAction = ExtensionAction & {
  visible?: () => boolean;
  confirmInExecute?: boolean;
};

export function buildFileActions(opts: {
  getFile: () => ActionableFile | null | undefined;
  context: ActionContext;
  include?: { deepSearch?: boolean; clearHistory?: boolean; open?: boolean };
  onRemoved?: (fileId: string) => void;
}): FileAction[] {
  const getFile = (): ActionableFile | null => {
    const file = opts.getFile();
    return file ? asFileHit(file) : null;
  };
  const base = {
    extensionId: 'file-search',
    category: 'file-action',
    context: opts.context,
  };
  const actions: FileAction[] = [];

  if (opts.include?.open) {
    actions.push({
      ...base,
      id: 'file-search:open',
      title: t('actions.open'),
      icon: 'icon:file',
      shortcut: 'Enter',
      visible: () => Boolean(getFile()?.path || getFile()?.url),
      execute: async () => {
        const file = getFile();
        if (!file) return;
        try {
          await recordSelectionForCurrentQuery(file.fileId);
        } catch {
          // Non-fatal: still open the file even if frecency recording fails.
        }
        if (file.path) {
          await openerService.openPath(null, file.path);
        } else if (file.url) {
          await openerService.open(null, file.url);
        }
      },
    });
  }

  actions.push(
    {
      ...base,
      id: 'file-search:open-in-browser',
      title: t('features.file_search.act.open_browser'),
      description: t('features.file_search.act.open_browser_desc'),
      icon: 'icon:globe',
      shortcut: 'Mod+O',
      visible: () => Boolean(getFile()?.url),
      execute: async () => {
        const file = getFile();
        if (file?.url) await openerService.open(null, file.url);
      },
    },
    {
      ...base,
      id: 'file-search:copy-web-link',
      title: t('features.file_search.act.copy_web_link'),
      description: t('features.file_search.act.copy_web_link_desc'),
      icon: 'icon:link',
      shortcut: 'Mod+Shift+L',
      visible: () => Boolean(getFile()?.url),
      execute: async () => {
        const file = getFile();
        if (file?.url) await writeText(file.url);
      },
    },
    {
      ...base,
      id: 'file-search:copy-markdown-link',
      title: t('features.file_search.act.copy_markdown_link'),
      description: t('features.file_search.act.copy_markdown_link_desc'),
      icon: 'icon:link',
      shortcut: 'Mod+Alt+L',
      visible: () => Boolean(getFile()?.url),
      execute: async () => {
        const file = getFile();
        if (file?.url) await writeText(`[${file.name}](${file.url})`);
      },
    },
    {
      ...base,
      id: 'file-search:reveal-in-finder',
      title: t('features.file_search.act.reveal'),
      description: t('features.file_search.act.reveal_desc'),
      icon: 'icon:folder',
      shortcut: 'Mod+R',
      visible: () => Boolean(getFile()?.path),
      execute: async () => {
        const file = getFile();
        if (file?.path) await openerService.reveal(file.extensionId ?? null, file.path);
      },
    },
    {
      ...base,
      id: 'file-search:copy-path',
      title: t('features.file_search.act.copy_path'),
      description: t('features.file_search.act.copy_path_desc'),
      icon: 'icon:clipboard',
      shortcut: 'Mod+Shift+C',
      visible: () => Boolean(getFile()?.path),
      execute: async () => {
        const file = getFile();
        if (file?.path) await writeText(file.path);
      },
    },
    {
      ...base,
      id: 'file-search:copy-name',
      title: t('features.file_search.act.copy_name'),
      description: t('features.file_search.act.copy_name_desc'),
      icon: 'icon:clipboard',
      shortcut: 'Mod+Alt+C',
      execute: async () => {
        const file = getFile();
        if (file) await writeText(file.name);
      },
    },
    {
      ...base,
      id: 'file-search:open-in-terminal',
      title: t('features.file_search.act.open_terminal'),
      description: t('features.file_search.act.open_terminal_desc'),
      icon: 'icon:terminal',
      shortcut: 'Mod+T',
      visible: () => {
        const file = getFile();
        return Boolean(file?.path && !file?.extensionId);
      },
      execute: async () => {
        const file = getFile();
        if (file?.path) await openInTerminal(parentDirOf(file));
      },
    },
    {
      ...base,
      id: 'file-search:pin',
      title: t('features.file_search.act.pin'),
      description: t('features.file_search.act.toggle_pin_desc'),
      icon: 'icon:pin',
      shortcut: 'Mod+.',
      visible: () => {
        const file = getFile();
        return file && file.path && !file.extensionId
          ? !fileSearchViewState.pinnedFiles.some((p) => p.fileId === file.fileId)
          : false;
      },
      execute: async () => {
        const file = getFile();
        if (file?.path) await togglePin(file.fileId, file.path);
      },
    },
    {
      ...base,
      id: 'file-search:unpin',
      title: t('features.file_search.act.unpin'),
      description: t('features.file_search.act.toggle_pin_desc'),
      icon: 'icon:pin',
      shortcut: 'Mod+.',
      visible: () => {
        const file = getFile();
        return file && file.path && !file.extensionId
          ? fileSearchViewState.pinnedFiles.some((p) => p.fileId === file.fileId)
          : false;
      },
      execute: async () => {
        const file = getFile();
        if (file?.path) await togglePin(file.fileId, file.path);
      },
    },
    {
      ...base,
      id: 'file-search:move-to-trash',
      title: t('features.file_search.act.trash'),
      description: t('features.file_search.act.trash_desc'),
      icon: 'icon:trash',
      shortcut: 'Control+X',
      confirmInExecute: true,
      destructive: true,
      visible: () => {
        const file = getFile();
        return Boolean(file?.path && !file?.extensionId);
      },
      execute: async () => {
        const file = getFile();
        if (!file?.path) return;
        // Asked here rather than through the action's `confirm` flag so every
        // caller of this descriptor is covered, and so the dialog can name the file.
        const confirmed = await feedbackService.confirmAlert({
          title: t('features.file_search.act.trash_confirm_title'),
          message: t('features.file_search.act.trash_confirm_message', { name: file.name }),
          confirmText: t('features.file_search.act.trash'),
          cancelText: t('common.cancel'),
          variant: 'danger',
        });
        if (!confirmed) return;
        try {
          await fileManagerService.trash(file.path);
          opts.onRemoved?.(file.fileId);
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
      ...base,
      id: 'file-search:quick-look',
      title: t('features.file_search.act.quick_look'),
      description: t('features.file_search.act.quick_look_desc'),
      icon: 'icon:eye',
      shortcut: 'Mod+Y',
      visible: () => Boolean(getFile()?.path) && !getFile()?.extensionId,
      execute: async () => {
        const file = getFile();
        if (!file?.path || file.extensionId) return;
        const ok = await quickLookPath(file.path);
        if (!ok) await openerService.openPath(null, file.path);
      },
    },
    {
      ...base,
      id: 'file-search:send-to-ai',
      title: t('features.file_search.act.send_ai'),
      description: t('features.file_search.act.send_ai_desc'),
      icon: 'icon:sparkles',
      shortcut: 'Mod+I',
      execute: async () => {
        const file = getFile();
        if (file) await primeAiChipForFile(file as FileHit);
      },
    },
  );

  if (opts.include?.clearHistory) {
    actions.push({
      ...base,
      id: 'file-search:clear-history',
      title: t('features.file_search.act.clear_history'),
      description: t('features.file_search.act.clear_history_desc'),
      icon: 'icon:trash',
      shortcut: 'Control+Shift+X',
      confirm: true,
      destructive: true,
      execute: async () => {
        await fileSearchClearHistory();
      },
    });
  }
  if (opts.include?.deepSearch) {
    actions.push({
      ...base,
      id: 'file-search:deep-search',
      title: t('features.file_search.act.search_everywhere'),
      description: t('features.file_search.act.search_everywhere_desc'),
      icon: 'icon:globe',
      shortcut: 'Mod+Shift+F',
      execute: runDeepSearch,
    });
  }
  return actions;
}
