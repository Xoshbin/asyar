import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { ocrCaptureScreenText } from './ocrCommands';

describe('ocrCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes ocr_capture_screen_text and returns captured text on success', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('Recognized text content');

    const result = await ocrCaptureScreenText();

    expect(invoke).toHaveBeenCalledWith('ocr_capture_screen_text', undefined);
    expect(result).toBe('Recognized text content');
  });

  it('returns null when user cancels or no text is captured', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);

    const result = await ocrCaptureScreenText();

    expect(invoke).toHaveBeenCalledWith('ocr_capture_screen_text', undefined);
    expect(result).toBeNull();
  });

  it('handles errors gracefully via invokeSafe and returns null', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Device unavailable'));

    const result = await ocrCaptureScreenText();

    expect(result).toBeNull();
  });
});
