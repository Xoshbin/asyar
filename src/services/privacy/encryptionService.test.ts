import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  cryptoGetStatus: vi.fn(),
  cryptoEncrypt: vi.fn(),
  cryptoDecrypt: vi.fn(),
}));

import {
  cryptoGetStatus,
  cryptoEncrypt,
  cryptoDecrypt,
} from '../../lib/ipc/commands';
import { encryptionService } from './encryptionService.svelte';

describe('encryptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encryptionService.reset();
  });

  it('init reflects active status when OS-backed', async () => {
    vi.mocked(cryptoGetStatus).mockResolvedValueOnce({
      status: 'active',
      isOsBacked: true,
    });
    await encryptionService.init();
    expect(encryptionService.current).toEqual({ status: 'active', isOsBacked: true });
  });

  it('init reflects fallback status on Linux without Secret Service', async () => {
    vi.mocked(cryptoGetStatus).mockResolvedValueOnce({
      status: 'fallback',
      isOsBacked: false,
    });
    await encryptionService.init();
    expect(encryptionService.current).toEqual({ status: 'fallback', isOsBacked: false });
  });

  it('init falls back to unknown when host call fails', async () => {
    vi.mocked(cryptoGetStatus).mockResolvedValueOnce(null);
    await encryptionService.init();
    expect(encryptionService.current).toEqual({ status: 'unknown' });
  });

  it('init is defensive against impossible status/isOsBacked combos', async () => {
    // active + !isOsBacked is never produced by Rust, but if it were the
    // service should not pretend protection is full.
    vi.mocked(cryptoGetStatus).mockResolvedValueOnce({
      status: 'active',
      isOsBacked: false,
    } as any);
    await encryptionService.init();
    expect(encryptionService.current).toEqual({ status: 'unknown' });
  });

  it('encrypt delegates to host', async () => {
    vi.mocked(cryptoEncrypt).mockResolvedValueOnce('enc:v1:abc');
    const r = await encryptionService.encrypt('hello');
    expect(r).toBe('enc:v1:abc');
    expect(cryptoEncrypt).toHaveBeenCalledWith('hello');
  });

  it('decrypt delegates to host', async () => {
    vi.mocked(cryptoDecrypt).mockResolvedValueOnce('hello');
    const r = await encryptionService.decrypt('enc:v1:abc');
    expect(r).toBe('hello');
    expect(cryptoDecrypt).toHaveBeenCalledWith('enc:v1:abc');
  });

  it('encrypt/decrypt return null on host failure', async () => {
    vi.mocked(cryptoEncrypt).mockResolvedValueOnce(null);
    vi.mocked(cryptoDecrypt).mockResolvedValueOnce(null);
    expect(await encryptionService.encrypt('x')).toBeNull();
    expect(await encryptionService.decrypt('y')).toBeNull();
  });
});
