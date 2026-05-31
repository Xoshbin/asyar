import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { scanForSecret } from './secretGuard';
import { invoke } from '@tauri-apps/api/core';

describe('scanForSecret', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes when the Rust scan reports no offending file', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(scanForSecret('/ext', 'secret-ABC-123')).resolves.toEqual({ leaked: false });
    expect(invoke).toHaveBeenCalledWith('scan_extension_for_secret', {
      path: '/ext',
      secret: 'secret-ABC-123',
    });
  });

  it('fails closed with the offending path when the Rust scan finds the secret', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('/ext/src/config.ts');
    await expect(scanForSecret('/ext', 'secret-ABC-123')).resolves.toEqual({
      leaked: true,
      path: '/ext/src/config.ts',
    });
  });

  it('treats an empty or whitespace secret as nothing to scan and never invokes Rust', async () => {
    await expect(scanForSecret('/ext', '')).resolves.toEqual({ leaked: false });
    await expect(scanForSecret('/ext', '   ')).resolves.toEqual({ leaked: false });
    expect(invoke).not.toHaveBeenCalled();
  });
});
