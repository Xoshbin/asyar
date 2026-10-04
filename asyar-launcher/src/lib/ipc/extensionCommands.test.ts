import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/log/logService', () => ({
  logService: { error: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { updateExtension } from './extensionCommands';

describe('extension command failure contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects update failures so callers do not continue post-update state changes', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('replacement failed');

    await expect(
      updateExtension({
        extensionId: 'org.example.extension',
        name: 'Example',
        slug: 'example',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        downloadUrl: 'https://example.com/extension.zip',
        checksum: 'abc123',
      }),
    ).rejects.toMatchObject({ name: 'IpcError', command: 'update_extension' });
  });
});
