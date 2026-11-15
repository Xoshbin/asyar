import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./invokeSafe', () => ({
  invokeSafe: vi.fn(),
  invokeRaw: vi.fn(),
}));

import { invokeSafe, invokeRaw } from './invokeSafe';
import {
  ocrCaptureScreenText,
  ocrCaptureScreenTextForExtension,
  ocrRecognizeImageFile,
  ocrCopyImageText,
} from './ocrCommands';

describe('ocrCommands IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ocrCaptureScreenText calls ocr_capture_screen_text via invokeSafe', async () => {
    vi.mocked(invokeSafe).mockResolvedValue('Extracted Text');
    const result = await ocrCaptureScreenText();
    expect(invokeSafe).toHaveBeenCalledWith('ocr_capture_screen_text');
    expect(result).toBe('Extracted Text');
  });

  it('ocrCaptureScreenTextForExtension calls ocr_capture_screen_text via invokeRaw', async () => {
    vi.mocked(invokeRaw).mockResolvedValue('Extracted Text');
    const result = await ocrCaptureScreenTextForExtension();
    expect(invokeRaw).toHaveBeenCalledWith('ocr_capture_screen_text');
    expect(result).toBe('Extracted Text');
  });

  it('ocrRecognizeImageFile calls ocr_recognize_image_file with imagePath', async () => {
    vi.mocked(invokeSafe).mockResolvedValue('File Text');
    const result = await ocrRecognizeImageFile('/path/to/image.png');
    expect(invokeSafe).toHaveBeenCalledWith('ocr_recognize_image_file', {
      imagePath: '/path/to/image.png',
    });
    expect(result).toBe('File Text');
  });

  it('ocrCopyImageText calls ocr_copy_image_text with imagePath', async () => {
    vi.mocked(invokeSafe).mockResolvedValue('Copied Text');
    const result = await ocrCopyImageText('/path/to/image.png');
    expect(invokeSafe).toHaveBeenCalledWith('ocr_copy_image_text', {
      imagePath: '/path/to/image.png',
    });
    expect(result).toBe('Copied Text');
  });
});
