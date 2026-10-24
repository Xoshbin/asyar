import { revealItemInDir } from '@tauri-apps/plugin-opener';
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
import { fileSearchViewState, runDeepSearch, togglePin } from './state.svelte';

type RootFile = { path: string; name: string; fileId: string; isDir?: boolean };

function asFileHit(file: FileHit | RootFile): FileHit {
  if ('type' in file) return file;
  return {
    ...file,
    type: file.isDir ? 'folder' : 'other',
    isDir: file.isDir ?? false,
    modifiedAt: 0,
    score: 0,
    pinned: false,
    source: 'local',
  };
}

function parentDirOf(file: FileHit): string {
  return file.isDir ? file.path : file.path.replace(/[/\\][^/\\]*$/, '');
}

export type FileAction = ExtensionAction & { visible?: () => boolean };

export function buildFileActions(opts: {
  getFile: () => FileHit | RootFile | null | undefined;
  context: ActionContext;
  include?: { deepSearch?: boolean; clearHistory?: boolean };
  onRemoved?: (fileId: string) => void;
}): FileAction[] {
  const getFile = (): FileHit | null => {
    const file = opts.getFile();
    return file ? asFileHit(file) : null;
  };
  const base = {
    extensionId: 'file-search',
    category: 'file-action',
    context: opts.context,
  };
  const actions: FileAction[] = [
    {
      ...base,
      id: 'file-search:reveal-in-finder',
      title: t('features.file_search.act.reveal'),
      description: t('features.file_search.act.reveal_desc'),
      icon: 'icon:folder',
      shortcut: 'Mod+R',
      execute: async () => {
        const file = getFile();
        if (file) await revealItemInDir(file.path);
      },
    },
    {
      ...base,
      id: 'file-search:copy-path',
      title: t('features.file_search.act.copy_path'),
      description: t('features.file_search.act.copy_path_desc'),
      icon: 'icon:clipboard',
      shortcut: 'Mod+Shift+C',
      execute: async () => {
        const file = getFile();
        if (file) await writeText(file.path);
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
      execute: async () => {
        const file = getFile();
        if (file) await openInTerminal(parentDirOf(file));
      },
    },
    {
      ...base,
      id: 'file-search:pin',
      title: t('features.file_search.act.pin'),
      description: t('features.file_search.act.toggle_pin_desc'),
      icon: 'icon:pin',
      shortcut: 'Mod+Shift+P',
      visible: () => {
        const file = getFile();
        return file
          ? !fileSearchViewState.pinnedFiles.some((p) => p.fileId === file.fileId)
          : false;
      },
      execute: async () => {
        const file = getFile();
        if (file) await togglePin(file.fileId, file.path);
      },
    },
    {
      ...base,
      id: 'file-search:unpin',
      title: t('features.file_search.act.unpin'),
      description: t('features.file_search.act.toggle_pin_desc'),
      icon: 'icon:pin',
      shortcut: 'Mod+Shift+P',
      visible: () => {
        const file = getFile();
        return file ? fileSearchViewState.pinnedFiles.some((p) => p.fileId === file.fileId) : false;
      },
      execute: async () => {
        const file = getFile();
        if (file) await togglePin(file.fileId, file.path);
      },
    },
    {
      ...base,
      id: 'file-search:move-to-trash',
      title: t('features.file_search.act.trash'),
      description: t('features.file_search.act.trash_desc'),
      icon: 'icon:trash',
      destructive: true,
      execute: async () => {
        const file = getFile();
        if (!file) return;
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
      execute: async () => {
        const file = getFile();
        if (!file) return;
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
        if (file) await primeAiChipForFile(file);
      },
    },
  ];

  if (opts.include?.clearHistory) {
    actions.push({
      ...base,
      id: 'file-search:clear-history',
      title: t('features.file_search.act.clear_history'),
      description: t('features.file_search.act.clear_history_desc'),
      icon: 'icon:trash',
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
