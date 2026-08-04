import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommandArgument } from 'asyar-sdk/contracts';

const getCommandArgMeta = vi.fn();
const dispatch = vi.fn();
const hideWindow = vi.fn();
const recordItemUsage = vi.fn();
const resetLauncherState = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/ipc/commandArgDefaultsCommands', () => ({
  commandArgDefaultsGet: vi.fn().mockResolvedValue({}),
  commandArgDefaultsSet: vi.fn().mockResolvedValue(undefined),
}));
// The seeding/provenance/gate algorithm now lives in Rust
// (extensions::argument_model::resolve); this test-only JS port stands in
// for the real IPC call. See argumentModelTestFake.ts.
vi.mock('../../lib/ipc/argumentModelCommands', async () => {
  const { fakeResolveCommandArguments } = await import('./argumentModelTestFake');
  return { resolveCommandArguments: fakeResolveCommandArguments };
});
vi.mock('../extension/extensionManager.svelte', () => ({
  default: {
    getCommandArgMeta: (id: string) => getCommandArgMeta(id),
    handleCommandAction: vi.fn(),
  },
}));
vi.mock('../extension/extensionDispatcher.svelte', () => ({
  dispatch: (req: unknown) => dispatch(req),
}));
vi.mock('../../lib/ipc/commands', () => ({
  hideWindow: () => hideWindow(),
  recordItemUsage: (id: string) => recordItemUsage(id),
}));
vi.mock('./SearchService', () => ({ searchService: { saveIndex: vi.fn() } }));
vi.mock('./topItemsCache', () => ({ invalidateTopItemsCache: vi.fn() }));
vi.mock('../../lib/launcher/launcherReset', () => ({
  resetLauncherState: () => resetLauncherState(),
}));

import { commandArgumentsService } from './commandArguments';

const OBJECT_ID = 'cmd_org.asyar.demo_do-thing';
const ARGS: CommandArgument[] = [{ name: 'q', type: 'text' }];

function stubCommand(mode: 'view' | 'background' | undefined) {
  getCommandArgMeta.mockResolvedValue({
    extensionId: 'org.asyar.demo',
    commandId: 'do-thing',
    commandName: 'Do Thing',
    isBuiltIn: false,
    args: ARGS,
    mode,
  });
}

async function runOnce() {
  await commandArgumentsService.enter(OBJECT_ID);
  commandArgumentsService.setValue('q', 'hi');
  await commandArgumentsService.submit();
}

describe('Tier 2 argument dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hideWindow.mockResolvedValue(undefined);
    recordItemUsage.mockResolvedValue(undefined);
    dispatch.mockResolvedValue(undefined);
    commandArgumentsService.reset();
  });

  it('hides the launcher after a background command', async () => {
    stubCommand('background');
    await runOnce();
    expect(dispatch).toHaveBeenCalled();
    expect(hideWindow).toHaveBeenCalled();
  });

  it('leaves the launcher open after a view command', async () => {
    stubCommand('view');
    await runOnce();
    expect(dispatch).toHaveBeenCalled();
    expect(hideWindow).not.toHaveBeenCalled();
  });

  it('leaves the launcher open when the manifest omits mode (defaults to view)', async () => {
    stubCommand(undefined);
    await runOnce();
    expect(dispatch).toHaveBeenCalled();
    expect(hideWindow).not.toHaveBeenCalled();
  });

  it('records usage either way', async () => {
    stubCommand('view');
    await runOnce();
    expect(recordItemUsage).toHaveBeenCalledWith(OBJECT_ID);
  });
});
