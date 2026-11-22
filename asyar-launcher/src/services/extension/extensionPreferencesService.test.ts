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
    ipcState.rows.filter((r) => r.extensionId === extensionId),
  ),
  extensionPreferencesSet: vi.fn(
    async (
      extensionId: string,
      commandId: string | null,
      key: string,
      value: string,
      isEncrypted: boolean,
    ) => {
      ipcState.rows = ipcState.rows.filter(
        (r) => !(r.extensionId === extensionId && r.commandId === commandId && r.key === key),
      );
      ipcState.rows.push({
        extensionId,
        commandId,
        key,
        value,
        isEncrypted,
        updatedAt: 0,
      });
    },
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
      { name: 'A', type: 'textfield', default: 'A-default', title: 'A' },
      { name: 'theme', type: 'textfield', default: 'light', title: 'Theme' },
    ],
    commands: {
      'cmd-1': [
        { name: 'B', type: 'textfield', default: 'B-default', title: 'B' },
        { name: 'otherKey', type: 'textfield', default: 'other-default', title: 'Other' },
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
    await expect(extensionPreferencesService.reset('ext.test', 'no-such-scope')).rejects.toThrow(
      /unknown scope/i,
    );
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

describe('extensionPreferencesService aiModel & clearing', () => {
  it('treats missing or incomplete aiModel objects as missing required preferences', async () => {
    extensionPreferencesService.registerManifest('ext.ai', {
      extension: [{ name: 'model', type: 'aiModel', title: 'AI Model', required: true }],
      commands: {
        run: [],
      },
    });

    // Unset -> missing
    let missing = await extensionPreferencesService.getMissingRequired('ext.ai', 'run');
    expect(missing.map((p) => p.name)).toEqual(['model']);

    // Incomplete object -> missing
    await extensionPreferencesService.set('ext.ai', null, 'model', {
      providerId: 'openai',
      modelId: '   ',
    });
    missing = await extensionPreferencesService.getMissingRequired('ext.ai', 'run');
    expect(missing.map((p) => p.name)).toEqual(['model']);

    // Valid object -> complete
    await extensionPreferencesService.set('ext.ai', null, 'model', {
      providerId: 'openai',
      modelId: 'gpt-4o',
    });
    missing = await extensionPreferencesService.getMissingRequired('ext.ai', 'run');
    expect(missing).toEqual([]);
  });

  it('clearing an optional aiModel preference with undefined persists null and resolves to undefined', async () => {
    extensionPreferencesService.registerManifest('ext.ai', {
      extension: [
        {
          name: 'model',
          type: 'aiModel',
          title: 'AI Model',
          default: { providerId: 'openai', modelId: 'gpt-4o' },
        },
        {
          name: 'fallbackModel',
          type: 'aiModel',
          title: 'Fallback Model',
        },
      ],
      commands: {},
    });

    await extensionPreferencesService.set('ext.ai', null, 'model', undefined);
    await extensionPreferencesService.set('ext.ai', null, 'fallbackModel', undefined);
    const effective = await extensionPreferencesService.getEffectivePreferences('ext.ai');
    expect(effective.extension.model).toBeUndefined();
    expect(effective.extension.fallbackModel).toBeUndefined();
  });

  it('reset(scope) restores aiModel manifest default or clears to undefined when no default', async () => {
    extensionPreferencesService.registerManifest('ext.ai', {
      extension: [
        {
          name: 'withDefault',
          type: 'aiModel',
          title: 'With Default',
          default: { providerId: 'openai', modelId: 'gpt-4o-mini' },
        },
        {
          name: 'noDefault',
          type: 'aiModel',
          title: 'No Default',
        },
      ],
      commands: {},
    });

    await extensionPreferencesService.set('ext.ai', null, 'withDefault', {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    });
    await extensionPreferencesService.set('ext.ai', null, 'noDefault', {
      providerId: 'ollama',
      modelId: 'llama3.2:latest',
    });

    await extensionPreferencesService.reset('ext.ai', 'extension');
    const after = await extensionPreferencesService.getEffectivePreferences('ext.ai');
    expect(after.extension.withDefault).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
    });
    expect(after.extension.noDefault).toBeUndefined();
  });
});
