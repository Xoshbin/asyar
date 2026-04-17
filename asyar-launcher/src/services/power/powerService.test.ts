import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { powerService } from './powerService';
import { invoke } from '@tauri-apps/api/core';

describe('powerService (host)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keepAwake forwards extensionId + options to power_keep_awake and returns the token', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('tok-1');

    const token = await powerService.keepAwake('ext-a', {
      system: true,
      reason: 'Transcribing audio',
    });

    expect(token).toBe('tok-1');
    expect(invoke).toHaveBeenCalledWith('power_keep_awake', {
      extensionId: 'ext-a',
      options: { system: true, reason: 'Transcribing audio' },
    });
  });

  it('keepAwake with null extensionId is forwarded unchanged (core caller)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('tok-core');

    await powerService.keepAwake(null, { reason: 'core' });

    expect(invoke).toHaveBeenCalledWith('power_keep_awake', {
      extensionId: null,
      options: { reason: 'core' },
    });
  });

  it('release forwards extensionId + token', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await powerService.release('ext-a', 'tok-1');

    expect(invoke).toHaveBeenCalledWith('power_release', {
      extensionId: 'ext-a',
      token: 'tok-1',
    });
  });

  it('list forwards extensionId and returns the array', async () => {
    const sample = [
      {
        token: 'tok-1',
        options: { system: true, display: false, disk: false },
        reason: 'x',
        createdAt: 0,
      },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(sample);

    const result = await powerService.list('ext-a');

    expect(invoke).toHaveBeenCalledWith('power_list', { extensionId: 'ext-a' });
    expect(result).toEqual(sample);
  });
});
