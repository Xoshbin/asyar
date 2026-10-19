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
});
