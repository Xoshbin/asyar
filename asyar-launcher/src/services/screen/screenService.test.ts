import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { screenService } from './screenService';
import { invoke } from '@tauri-apps/api/core';

describe('screenService (host)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pickColor forwards extensionId to screen_pick_color and returns the color', async () => {
    const sample = { r: 26, g: 43, b: 60, hex: '#1a2b3c' };
    vi.mocked(invoke).mockResolvedValueOnce(sample);

    const color = await screenService.pickColor('ext-a');

    expect(color).toEqual(sample);
    expect(invoke).toHaveBeenCalledWith('screen_pick_color', { extensionId: 'ext-a' });
  });

  it('pickColor with null extensionId is forwarded unchanged (core caller)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);

    await screenService.pickColor(null);

    expect(invoke).toHaveBeenCalledWith('screen_pick_color', { extensionId: null });
  });

  it('pickColor returns null when the user cancels', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);

    const color = await screenService.pickColor('ext-a');

    expect(color).toBeNull();
  });
});
