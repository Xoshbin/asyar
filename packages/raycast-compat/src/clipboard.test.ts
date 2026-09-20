import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Clipboard } from './clipboard';
import { setRaycastContext } from './context';
import type { IClipboardHistoryService } from 'asyar-sdk/contracts';
import { ClipboardItemType } from 'asyar-sdk/contracts';

describe('Clipboard compat API', () => {
  let mockClipboardService: Partial<IClipboardHistoryService>;

  beforeEach(() => {
    mockClipboardService = {
      writeToClipboard: vi.fn().mockResolvedValue(undefined),
      readCurrentText: vi.fn().mockResolvedValue('existing text'),
      readCurrentClipboard: vi.fn().mockResolvedValue({
        type: ClipboardItemType.Text,
        content: 'existing text',
      }),
      simulatePaste: vi.fn().mockResolvedValue(true),
      clearNonFavorites: vi.fn().mockResolvedValue(true),
    };

    setRaycastContext({
      getService: vi.fn().mockImplementation((ns: string) => {
        if (ns === 'clipboard') return mockClipboardService;
        throw new Error(`Unknown service ${ns}`);
      }),
    } as any);
  });

  it('copies string text', async () => {
    await Clipboard.copy('Hello World');

    expect(mockClipboardService.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ClipboardItemType.Text,
        content: 'Hello World',
      }),
    );
  });

  it('copies numbers as strings', async () => {
    await Clipboard.copy(12345);

    expect(mockClipboardService.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ClipboardItemType.Text,
        content: '12345',
      }),
    );
  });

  it('copies html content', async () => {
    await Clipboard.copy({ html: '<h1>Title</h1>' });

    expect(mockClipboardService.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ClipboardItemType.Html,
        content: '<h1>Title</h1>',
      }),
    );
  });

  it('copies file paths', async () => {
    await Clipboard.copy({ file: '/Users/test/file.txt' });

    expect(mockClipboardService.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ClipboardItemType.Files,
        content: JSON.stringify(['/Users/test/file.txt']),
      }),
    );
  });

  it('reads current text', async () => {
    const text = await Clipboard.readText();
    expect(text).toBe('existing text');
    expect(mockClipboardService.readCurrentText).toHaveBeenCalled();
  });

  it('returns undefined when clipboard text is empty', async () => {
    (mockClipboardService.readCurrentText as any).mockResolvedValueOnce('');
    const text = await Clipboard.readText();
    expect(text).toBeUndefined();
  });

  it('clears clipboard', async () => {
    await Clipboard.clear();
    expect(mockClipboardService.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ClipboardItemType.Text,
        content: '',
      }),
    );
  });

  it('pastes text by copying and simulating paste', async () => {
    await Clipboard.paste('Pasted');
    expect(mockClipboardService.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ClipboardItemType.Text,
        content: 'Pasted',
      }),
    );
    expect(mockClipboardService.simulatePaste).toHaveBeenCalled();
  });
});
