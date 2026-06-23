import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { processService } from './processService';
import { invoke } from '@tauri-apps/api/core';

describe('processService (host)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('list forwards extensionId + positional args to process_list', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    await processService.list('ext-a', 'chrome', 'cpu');

    expect(invoke).toHaveBeenCalledWith('process_list', {
      extensionId: 'ext-a',
      query: 'chrome',
      sortBy: 'cpu',
    });
  });

  it('list with null extensionId + empty filter is forwarded unchanged (core caller)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    await processService.list(null, undefined, 'memory');

    expect(invoke).toHaveBeenCalledWith('process_list', {
      extensionId: null,
      query: undefined,
      sortBy: 'memory',
    });
  });

  it('kill forwards positional args to process_kill', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ killed: [1], failed: [] });

    const result = await processService.kill('ext-a', [1], false, true);

    expect(invoke).toHaveBeenCalledWith('process_kill', {
      extensionId: 'ext-a',
      pids: [1],
      force: false,
      confirmedProtected: true,
    });
    expect(result).toEqual({ killed: [1], failed: [] });
  });

  // Regression: simulates how ExtensionIpcRouter.dispatchApiCall maps the SDK
  // proxy payload to host-service args — it spreads Object.values(payload)
  // POSITIONALLY after the injected extensionId. The host service signature
  // MUST line up with the proxy's payload-key insertion order, or runtime
  // throws (e.g. "options.query of undefined" on the empty-filter first load).
  describe('router positional dispatch (the seam the object-shaped signature missed)', () => {
    it('list: proxy {query,sortBy} payload dispatched positionally reaches process_list', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]);

      // What ProcessServiceProxy.list sends (empty filter => query undefined).
      const proxyPayload = { query: undefined, sortBy: 'cpu' as const };
      const extensionId = 'ext-a';
      // What the router does: [extensionId, ...Object.values(payload)].
      const args = [extensionId, ...Object.values(proxyPayload)] as Parameters<
        typeof processService.list
      >;

      await processService.list(...args);

      expect(invoke).toHaveBeenCalledWith('process_list', {
        extensionId: 'ext-a',
        query: undefined,
        sortBy: 'cpu',
      });
    });

    it('kill: proxy {pids,force,confirmedProtected} payload dispatched positionally reaches process_kill', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({ killed: [3], failed: [] });

      const proxyPayload = { pids: [3], force: true, confirmedProtected: false };
      const extensionId = 'ext-a';
      const args = [extensionId, ...Object.values(proxyPayload)] as Parameters<
        typeof processService.kill
      >;

      await processService.kill(...args);

      expect(invoke).toHaveBeenCalledWith('process_kill', {
        extensionId: 'ext-a',
        pids: [3],
        force: true,
        confirmedProtected: false,
      });
    });
  });
});
