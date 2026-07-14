import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn(), registerRetry: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { getFileThumbnail } from './thumbnailCommands';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getFileThumbnail', () => {
  it('calls invoke with path and maxDim', async () => {
    mockInvoke.mockResolvedValue('asyar-thumb://localhost/abc.png');
    const result = await getFileThumbnail('/r/photo.png', 64);
    expect(mockInvoke).toHaveBeenCalledWith('get_file_thumbnail', {
      path: '/r/photo.png',
      maxDim: 64,
    });
    expect(result).toBe('asyar-thumb://localhost/abc.png');
  });

  it('omits maxDim when not provided', async () => {
    mockInvoke.mockResolvedValue(null);
    await getFileThumbnail('/r/photo.png');
    expect(mockInvoke).toHaveBeenCalledWith('get_file_thumbnail', {
      path: '/r/photo.png',
      maxDim: undefined,
    });
  });

  it('returns null when the backend has no thumbnail strategy', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await getFileThumbnail('/r/archive.zip');
    expect(result).toBeNull();
  });

  it('returns null (not throw) on invoke failure', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'));
    const result = await getFileThumbnail('/r/photo.png');
    expect(result).toBeNull();
  });
});
