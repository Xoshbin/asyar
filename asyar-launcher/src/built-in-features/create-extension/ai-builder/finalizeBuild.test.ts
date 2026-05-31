import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./secretGuard', () => ({ scanForSecret: vi.fn() }));

const reloadExtensions = vi.fn();
vi.mock('asyar-sdk/contracts', () => ({
  ExtensionManagerProxy: class {
    reloadExtensions = reloadExtensions;
  },
}));

import { finalizeBuild } from './finalizeBuild';
import { invoke } from '@tauri-apps/api/core';
import { scanForSecret } from './secretGuard';
import { buildJobStore } from './buildJobStore.svelte';

describe('finalizeBuild', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildJobStore.reset();
  });

  it('registers the extension then reloads when there is no build secret', async () => {
    buildJobStore.buildSecret = null;

    const result = await finalizeBuild('/home/me/AsyarExtensions/com.x', 'com.x');

    expect(result).toEqual({ leaked: false });
    expect(scanForSecret).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('register_dev_extension', {
      extensionId: 'com.x',
      path: '/home/me/AsyarExtensions/com.x',
    });
    expect(reloadExtensions).toHaveBeenCalledOnce();
  });

  it('scans for the secret and still registers when the build is clean', async () => {
    buildJobStore.buildSecret = 'secret-ABC-123';
    vi.mocked(scanForSecret).mockResolvedValueOnce({ leaked: false });

    const result = await finalizeBuild('/ext', 'com.x');

    expect(scanForSecret).toHaveBeenCalledWith('/ext', 'secret-ABC-123');
    expect(result).toEqual({ leaked: false });
    expect(invoke).toHaveBeenCalledWith('register_dev_extension', {
      extensionId: 'com.x',
      path: '/ext',
    });
    expect(reloadExtensions).toHaveBeenCalledOnce();
  });

  it('fails closed — does not register or reload when the secret leaked', async () => {
    buildJobStore.buildSecret = 'secret-ABC-123';
    vi.mocked(scanForSecret).mockResolvedValueOnce({ leaked: true, path: '/ext/src/config.ts' });

    const result = await finalizeBuild('/ext', 'com.x');

    expect(result).toEqual({ leaked: true, path: '/ext/src/config.ts' });
    expect(invoke).not.toHaveBeenCalled();
    expect(reloadExtensions).not.toHaveBeenCalled();
  });
});
