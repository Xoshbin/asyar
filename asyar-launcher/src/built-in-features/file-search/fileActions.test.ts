import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionContext } from 'asyar-sdk/contracts';

const {
  quickLookPath,
  openPath,
  open: openMock,
  reveal: revealMock,
  confirmAlert,
} = vi.hoisted(() => ({
  quickLookPath: vi.fn(),
  openPath: vi.fn(),
  open: vi.fn(),
  reveal: vi.fn(),
  confirmAlert: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn() }));
vi.mock('../../lib/ipc/fileSearchCommands', () => ({
  fileSearchClearHistory: vi.fn(),
  openInTerminal: vi.fn(),
  quickLookPath,
}));
vi.mock('../../services/opener/openerService', () => ({
  openerService: { openPath, open: openMock, reveal: revealMock },
}));
vi.mock('../../services/fileManager/fileManagerService', () => ({
  fileManagerService: { trash: vi.fn() },
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn(), confirmAlert },
}));
vi.mock('./aiChipBridge', () => ({ primeAiChipForFile: vi.fn() }));
vi.mock('./state.svelte', () => ({
  runDeepSearch: vi.fn(),
  togglePin: vi.fn(),
  fileSearchViewState: { pinnedFiles: [] },
}));

import { buildFileActions } from './fileActions';
import { fileManagerService } from '../../services/fileManager/fileManagerService';
import { writeText } from 'tauri-plugin-clipboard-x-api';

const file = { fileId: 'abc', path: '/tmp/report.txt', name: 'report.txt' };

describe('buildFileActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds the same shared actions for both contexts', () => {
    const core = buildFileActions({ getFile: () => file, context: ActionContext.CORE });
    const view = buildFileActions({
      getFile: () => file,
      context: ActionContext.EXTENSION_VIEW,
    });
    expect(core).toHaveLength(12);
    expect(view.map((action) => action.id)).toEqual(core.map((action) => action.id));
    expect(core.every((action) => action.context === ActionContext.CORE)).toBe(true);

    const pin = core.find((a) => a.id === 'file-search:pin');
    const unpin = core.find((a) => a.id === 'file-search:unpin');
    expect(pin?.icon).toBe('icon:pin');
    expect(pin?.shortcut).toBe('Mod+Shift+P');
    expect(unpin?.icon).toBe('icon:pin');
    expect(unpin?.shortcut).toBe('Mod+Shift+P');
    expect(pin?.visible?.()).toBe(true);
    expect(unpin?.visible?.()).toBe(false);
  });

  it('omits view-only actions unless requested and binds Quick Look to Mod+Y', () => {
    const shared = buildFileActions({ getFile: () => file, context: ActionContext.CORE });
    expect(shared.map((action) => action.id)).not.toContain('file-search:deep-search');
    expect(shared.find((action) => action.id === 'file-search:quick-look')?.shortcut).toBe('Mod+Y');

    const view = buildFileActions({
      getFile: () => file,
      context: ActionContext.EXTENSION_VIEW,
      include: { deepSearch: true, clearHistory: true },
    });
    expect(view).toHaveLength(14);
  });

  it('falls back to opening the file when Quick Look reports failure', async () => {
    quickLookPath.mockResolvedValue(false);
    const actions = buildFileActions({ getFile: () => file, context: ActionContext.CORE });
    await actions.find((action) => action.id === 'file-search:quick-look')?.execute?.();
    expect(openPath).toHaveBeenCalledWith(null, file.path);
  });

  describe('file-search:move-to-trash', () => {
    const trashAction = () => {
      const action = buildFileActions({ getFile: () => file, context: ActionContext.CORE }).find(
        (a) => a.id === 'file-search:move-to-trash',
      );
      if (!action) throw new Error('move-to-trash action missing');
      return action;
    };

    it('asks first, naming the file, and trashes nothing when declined', async () => {
      confirmAlert.mockResolvedValue(false);

      await trashAction().execute();

      expect(confirmAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'danger',
          message: expect.stringContaining('report.txt'),
        }),
      );
      expect(fileManagerService.trash).not.toHaveBeenCalled();
    });

    it('moves the file to the trash once confirmed', async () => {
      confirmAlert.mockResolvedValue(true);

      await trashAction().execute();

      expect(fileManagerService.trash).toHaveBeenCalledWith('/tmp/report.txt');
    });
  });

  describe('cloud / remote file actions', () => {
    const cloudFile = {
      fileId: 'gdrive_123',
      name: 'Q3 Financial Plan',
      url: 'https://docs.google.com/spreadsheets/d/123',
    };

    it('shows browser/link actions and hides local-only actions when path is missing', () => {
      const actions = buildFileActions({
        getFile: () => cloudFile,
        context: ActionContext.CORE,
      });

      const openBrowser = actions.find((a) => a.id === 'file-search:open-in-browser');
      const copyWebLink = actions.find((a) => a.id === 'file-search:copy-web-link');
      const copyMdLink = actions.find((a) => a.id === 'file-search:copy-markdown-link');
      const reveal = actions.find((a) => a.id === 'file-search:reveal-in-finder');
      const copyPath = actions.find((a) => a.id === 'file-search:copy-path');
      const terminal = actions.find((a) => a.id === 'file-search:open-in-terminal');
      const trash = actions.find((a) => a.id === 'file-search:move-to-trash');
      const quickLook = actions.find((a) => a.id === 'file-search:quick-look');

      expect(openBrowser?.visible?.()).toBe(true);
      expect(copyWebLink?.visible?.()).toBe(true);
      expect(copyMdLink?.visible?.()).toBe(true);

      expect(reveal?.visible?.()).toBe(false);
      expect(copyPath?.visible?.()).toBe(false);
      expect(terminal?.visible?.()).toBe(false);
      expect(trash?.visible?.()).toBe(false);
      expect(quickLook?.visible?.()).toBe(false);
    });

    it('executes open-in-browser, copy-web-link, and copy-markdown-link', async () => {
      const actions = buildFileActions({
        getFile: () => cloudFile,
        context: ActionContext.CORE,
      });

      await actions.find((a) => a.id === 'file-search:open-in-browser')?.execute();
      expect(openMock).toHaveBeenCalledWith(null, 'https://docs.google.com/spreadsheets/d/123');

      await actions.find((a) => a.id === 'file-search:copy-web-link')?.execute();
      expect(writeText).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/123');

      await actions.find((a) => a.id === 'file-search:copy-markdown-link')?.execute();
      expect(writeText).toHaveBeenCalledWith(
        '[Q3 Financial Plan](https://docs.google.com/spreadsheets/d/123)',
      );
    });

    it('hides destructive host actions and scopes reveal for extension-contributed files', async () => {
      const extensionFile = {
        fileId: 'remote-1',
        name: 'Mirrored Doc',
        path: '/Users/test/GoogleDrive/Doc.pdf',
        extensionId: 'org.example.gdrive',
      };
      const actions = buildFileActions({
        getFile: () => extensionFile,
        context: ActionContext.CORE,
      });

      expect(actions.find((a) => a.id === 'file-search:move-to-trash')?.visible?.()).toBe(false);
      expect(actions.find((a) => a.id === 'file-search:open-in-terminal')?.visible?.()).toBe(false);
      expect(actions.find((a) => a.id === 'file-search:pin')?.visible?.()).toBe(false);
      expect(actions.find((a) => a.id === 'file-search:unpin')?.visible?.()).toBe(false);
      expect(actions.find((a) => a.id === 'file-search:reveal-in-finder')?.visible?.()).toBe(true);

      await actions.find((a) => a.id === 'file-search:reveal-in-finder')?.execute();
      expect(revealMock).toHaveBeenCalledWith(
        'org.example.gdrive',
        '/Users/test/GoogleDrive/Doc.pdf',
      );
    });
  });
});
