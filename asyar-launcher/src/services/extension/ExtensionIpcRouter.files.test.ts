import { describe, expect, it, vi } from 'vitest';

vi.mock('../log/logService', () => ({ logService: {} }));
vi.mock('../../lib/ipc/commands', () => ({}));
vi.mock('../../lib/ipc/shortcodeCommands', () => ({}));
vi.mock('./workerHost.svelte', () => ({ workerHost: {} }));
vi.mock('./ipc/pipeline', () => ({ runIpcPipeline: vi.fn() }));
vi.mock('asyar-sdk/contracts', () => ({ messageBroker: {} }));

import { ALWAYS_INJECTS_CALLER_ID, METHOD_PARAM_SCHEMAS } from './ExtensionIpcRouter';

describe('files IPC contracts', () => {
  it('readRange has an explicit path/options schema and caller injection', () => {
    expect(METHOD_PARAM_SCHEMAS['files:readRange']).toEqual(['path', 'opts']);
    expect(ALWAYS_INJECTS_CALLER_ID.has('files')).toBe(true);
  });
});
