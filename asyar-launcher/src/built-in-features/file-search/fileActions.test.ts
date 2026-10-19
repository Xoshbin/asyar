import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionContext } from 'asyar-sdk/contracts';

const { quickLookPath, openPath } = vi.hoisted(() => ({
  quickLookPath: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn() }));
vi.mock('../../lib/ipc/fileSearchCommands', () => ({
  fileSearchClearHistory: vi.fn(),
  openInTerminal: vi.fn(),
  quickLookPath,
}));
vi.mock('../../services/opener/openerService', () => ({ openerService: { openPath } }));
vi.mock('../../services/fileManager/fileManagerService', () => ({
  fileManagerService: { trash: vi.fn() },
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));
vi.mock('./aiChipBridge', () => ({ primeAiChipForFile: vi.fn() }));
vi.mock('./state.svelte', () => ({ runDeepSearch: vi.fn(), togglePin: vi.fn() }));

import { buildFileActions } from './fileActions';

const file = { fileId: 'abc', path: '/tmp/report.txt', name: 'report.txt' };

describe('buildFileActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds the same eight shared actions for both contexts', () => {
    const core = buildFileActions({ getFile: () => file, context: ActionContext.CORE });
    const view = buildFileActions({
      getFile: () => file,
      context: ActionContext.EXTENSION_VIEW,
    });
    expect(core).toHaveLength(8);
    expect(view.map((action) => action.id)).toEqual(core.map((action) => action.id));
    expect(core.every((action) => action.context === ActionContext.CORE)).toBe(true);
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
    expect(view).toHaveLength(10);
  });

  it('falls back to opening the file when Quick Look reports failure', async () => {
    quickLookPath.mockResolvedValue(false);
    const actions = buildFileActions({ getFile: () => file, context: ActionContext.CORE });
    await actions.find((action) => action.id === 'file-search:quick-look')?.execute?.();
    expect(openPath).toHaveBeenCalledWith(null, file.path);
  });
});
