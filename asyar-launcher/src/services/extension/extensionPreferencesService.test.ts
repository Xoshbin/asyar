import { describe, it, expect, vi, beforeEach } from 'vitest';

interface IpcRow {
  extensionId: string;
  commandId: string | null;
  key: string;
  value: string;
  isEncrypted: boolean;
  updatedAt: number;
}

const ipcState = { rows: [] as IpcRow[] };

vi.mock('../../lib/ipc/commands', () => ({
  extensionPreferencesGetAll: vi.fn(async (extensionId: string) =>
    ipcState.rows.filter((r) => r.extensionId === extensionId)
  ),
  extensionPreferencesSet: vi.fn(
    async (
      extensionId: string,
      commandId: string | null,
      key: string,
      value: string,
      isEncrypted: boolean
    ) => {
      ipcState.rows = ipcState.rows.filter(
        (r) =>
          !(
            r.extensionId === extensionId &&
            r.commandId === commandId &&
            r.key === key
          )
      );
      ipcState.rows.push({
        extensionId,
        commandId,
        key,
        value,
        isEncrypted,
        updatedAt: 0,
      });
    }
  ),
  extensionPreferencesReset: vi.fn(async (extensionId: string) => {
    ipcState.rows = ipcState.rows.filter((r) => r.extensionId !== extensionId);
  }),
}));

vi.mock('./extensionIframeManager.svelte', () => ({
  extensionIframeManager: {
    sendPreferencesToExtension: vi.fn(),
  },
}));

import { extensionPreferencesService } from './extensionPreferencesService.svelte';
import { extensionIframeManager } from './extensionIframeManager.svelte';

function registerDeclarations() {
  extensionPreferencesService.registerManifest('ext.test', {
    extension: [
      { name: 'A', type: 'string', default: 'A-default', title: 'A' },
      { name: 'theme', type: 'string', default: 'light', title: 'Theme' },
    ],
    commands: {
      'cmd-1': [
        { name: 'B', type: 'string', default: 'B-default', title: 'B' },
        { name: 'otherKey', type: 'string', default: 'other-default', title: 'Other' },
      ],
    },
  });
}

beforeEach(() => {
  ipcState.rows = [];
  extensionPreferencesService._resetForTesting();
  vi.clearAllMocks();
});

describe('extensionPreferencesService.reset(scope)', () => {
  it('resets only extension-scope prefs when scope = "extension"', async () => {
    registerDeclarations();
    await extensionPreferencesService.set('ext.test', null, 'A', 'modified');
    await extensionPreferencesService.set('ext.test', 'cmd-1', 'B', 'modified');

    await extensionPreferencesService.reset('ext.test', 'extension');

    const after = await extensionPreferencesService.getEffectivePreferences('ext.test');
    expect(after.extension.A).toBe('A-default');
    expect(after.commands['cmd-1'].B).toBe('modified');
  });

  it('resets only a specific command scope', async () => {
    registerDeclarations();
    await extensionPreferencesService.set('ext.test', null, 'A', 'modified');
    await extensionPreferencesService.set('ext.test', 'cmd-1', 'B', 'modified');

    await extensionPreferencesService.reset('ext.test', 'cmd-1');

    const after = await extensionPreferencesService.getEffectivePreferences('ext.test');
    expect(after.extension.A).toBe('modified');
    expect(after.commands['cmd-1'].B).toBe('B-default');
  });

  it('rejects unknown scope with a helpful error', async () => {
    registerDeclarations();
    await expect(
      extensionPreferencesService.reset('ext.test', 'no-such-scope')
    ).rejects.toThrow(/unknown scope/i);
  });

  it('wipes everything via Rust when no scope is provided', async () => {
    registerDeclarations();
    await extensionPreferencesService.set('ext.test', null, 'A', 'modified');
    await extensionPreferencesService.set('ext.test', 'cmd-1', 'B', 'modified');

    await extensionPreferencesService.reset('ext.test');

    const after = await extensionPreferencesService.getEffectivePreferences('ext.test');
    expect(after.extension.A).toBe('A-default');
    expect(after.commands['cmd-1'].B).toBe('B-default');
  });
});

describe('extensionPreferencesService sync re-emit', () => {
  it('pushes fresh bundle to iframe after set()', async () => {
    registerDeclarations();
    await extensionPreferencesService.set('ext.test', null, 'theme', 'dark');

    expect(extensionIframeManager.sendPreferencesToExtension).toHaveBeenCalled();
    const calls = (extensionIframeManager.sendPreferencesToExtension as any).mock.calls;
    const [extId, bundle] = calls[calls.length - 1];
    expect(extId).toBe('ext.test');
    expect(bundle.extension.theme).toBe('dark');
  });

  it('pushes fresh bundle to iframe after reset() with scope', async () => {
    registerDeclarations();
    await extensionPreferencesService.set('ext.test', null, 'theme', 'dark');
    vi.mocked(extensionIframeManager.sendPreferencesToExtension).mockClear();

    await extensionPreferencesService.reset('ext.test', 'extension');

    expect(extensionIframeManager.sendPreferencesToExtension).toHaveBeenCalled();
  });
});
