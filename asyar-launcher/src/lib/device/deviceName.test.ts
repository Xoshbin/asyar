import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/plugin-os', () => ({
  hostname: vi.fn(),
}));

import { hostname } from '@tauri-apps/plugin-os';
import { getDeviceName } from './deviceName';

describe('getDeviceName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns hostname when available', async () => {
    vi.mocked(hostname).mockResolvedValueOnce('MacBook-Pro.local');
    const name = await getDeviceName();
    expect(name).toBe('MacBook-Pro.local');
  });

  it('trims whitespace from hostname', async () => {
    vi.mocked(hostname).mockResolvedValueOnce('  workstation-pc  ');
    const name = await getDeviceName();
    expect(name).toBe('workstation-pc');
  });

  it('falls back to default if hostname is empty', async () => {
    vi.mocked(hostname).mockResolvedValueOnce('   ');
    const name = await getDeviceName();
    expect(name).toBe('Asyar Device');
  });

  it('falls back to default if hostname rejects', async () => {
    vi.mocked(hostname).mockRejectedValueOnce(new Error('os error'));
    const name = await getDeviceName();
    expect(name).toBe('Asyar Device');
  });
});
