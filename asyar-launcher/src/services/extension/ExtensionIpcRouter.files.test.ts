import { describe, expect, it, vi } from 'vitest';

vi.mock('../log/logService', () => ({ logService: {} }));
vi.mock('../../lib/ipc/commands', () => ({}));
vi.mock('../../lib/ipc/shortcodeCommands', () => ({}));
vi.mock('./workerHost.svelte', () => ({ workerHost: {} }));
vi.mock('./ipc/pipeline', () => ({ runIpcPipeline: vi.fn() }));
vi.mock('asyar-sdk/contracts', () => ({ messageBroker: {} }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../feedback/feedbackService.svelte', () => ({ feedbackService: {} }));

import { invoke } from '@tauri-apps/api/core';
import { filesService } from '../files/filesService';
import {
  ALWAYS_INJECTS_CALLER_ID,
  INJECTS_EXTENSION_ID,
  METHOD_PARAM_SCHEMAS,
  ExtensionIpcRouter,
} from './ExtensionIpcRouter';

describe('files IPC contracts', () => {
  it('steam_extension_glob_call_contract', async () => {
    const router = new ExtensionIpcRouter({ files: filesService }, vi.fn(), vi.fn(), vi.fn());
    const pattern = '/Steam/appcache/librarycache/123/' + '?'.repeat(40) + '.jpg';
    const paths = ['/Steam/appcache/librarycache/123/' + 'a'.repeat(40) + '.jpg'];
    for (const payload of [{ pattern }, { pattern, opts: { maxResults: 5 } }]) {
      vi.mocked(invoke).mockResolvedValueOnce(paths);
      const hits = await (router as any).dispatchApiCall(
        'asyar:api:files:glob',
        payload,
        'steam',
        false,
      );
      expect(hits).toEqual(paths);
      expect(typeof hits[0]).toBe('string');
      expect(invoke).toHaveBeenLastCalledWith('files_glob', {
        extensionId: 'steam',
        pattern,
        maxResults: payload.opts?.maxResults,
      });
    }
  });

  it('globEntries has an explicit pattern/options schema', () => {
    expect(METHOD_PARAM_SCHEMAS['files:globEntries']).toEqual(['pattern', 'opts']);
  });
  it('readRange has an explicit path/options schema and caller injection', () => {
    expect(METHOD_PARAM_SCHEMAS['files:readRange']).toEqual(['path', 'opts']);
    expect(ALWAYS_INJECTS_CALLER_ID.has('files')).toBe(true);
  });

  it('exists has an explicit path schema and forwards to files_exists', async () => {
    expect(METHOD_PARAM_SCHEMAS['files:exists']).toEqual(['path']);
    const router = new ExtensionIpcRouter({ files: filesService }, vi.fn(), vi.fn(), vi.fn());
    vi.mocked(invoke).mockResolvedValueOnce(false);
    const exists = await (router as any).dispatchApiCall(
      'asyar:api:files:exists',
      { path: '/tmp/repo/.git/HEAD' },
      'ext.a',
      false,
    );
    expect(exists).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith('files_exists', {
      extensionId: 'ext.a',
      pathStr: '/tmp/repo/.git/HEAD',
    });
  });

  it('icon has an explicit path schema and forwards to files_icon', async () => {
    expect(METHOD_PARAM_SCHEMAS['files:icon']).toEqual(['path']);
    const router = new ExtensionIpcRouter({ files: filesService }, vi.fn(), vi.fn(), vi.fn());
    vi.mocked(invoke).mockResolvedValueOnce('asyar-thumb://localhost/icon.png');
    const iconUrl = await (router as any).dispatchApiCall(
      'asyar:api:files:icon',
      { path: '/Applications/Safari.app' },
      'ext.a',
      false,
    );
    expect(iconUrl).toBe('asyar-thumb://localhost/icon.png');
    expect(invoke).toHaveBeenLastCalledWith('files_icon', {
      extensionId: 'ext.a',
      pathStr: '/Applications/Safari.app',
    });
  });
});

describe('environment:getPaths IPC contract', () => {
  it('declares an empty param schema and injects extensionId', async () => {
    expect(METHOD_PARAM_SCHEMAS['environment:getPaths']).toEqual([]);
    expect(INJECTS_EXTENSION_ID.has('environment')).toBe(true);

    const getPaths = vi.fn(async (extensionId: string) => ({
      home: '/Users/alice',
      appData: '/Users/alice/Library/Application Support',
      localAppData: '/Users/alice/Library/Application Support',
      config: '/Users/alice/Library/Application Support',
      _caller: extensionId,
    }));
    const router = new ExtensionIpcRouter({ environment: { getPaths } }, vi.fn(), vi.fn(), vi.fn());
    const result = await (router as any).dispatchApiCall(
      'asyar:api:environment:getPaths',
      undefined,
      'ext.files',
      false,
    );

    expect(getPaths).toHaveBeenCalledWith('ext.files');
    expect(result.home).toBe('/Users/alice');
  });
});
