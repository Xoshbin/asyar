import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  ocrCaptureScreenText: vi.fn(),
}));

import { ocrCaptureScreenText } from '../../lib/ipc/commands';
import screenOcrExtension from './index';

describe('ScreenOcrExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles capture-text command and invokes ocrCaptureScreenText', async () => {
    vi.mocked(ocrCaptureScreenText).mockResolvedValueOnce('Captured Text');

    const result = await screenOcrExtension.executeCommand('capture-text');

    expect(ocrCaptureScreenText).toHaveBeenCalledTimes(1);
    expect(result).toBe('Captured Text');
  });

  it('returns undefined for unknown commands', async () => {
    const result = await screenOcrExtension.executeCommand('unknown-command');

    expect(ocrCaptureScreenText).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
