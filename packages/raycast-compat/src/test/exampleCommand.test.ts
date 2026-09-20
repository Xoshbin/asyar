import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Clipboard, LocalStorage, showHUD, getPreferenceValues, setRaycastContext } from '../index';
import type {
  IClipboardHistoryService,
  IStorageService,
  IFeedbackService,
} from 'asyar-sdk/contracts';

/**
 * Example Raycast command: "Save and Copy Note"
 * A typical Raycast command written against @raycast/api
 */
async function copyFormattedNoteCommand(inputNote: string) {
  const prefs = getPreferenceValues<{ notePrefix?: string }>();
  const prefix = prefs.notePrefix ?? '[Note]';

  // Read previous note from storage
  const previousNote = await LocalStorage.getItem<string>('last_saved_note');

  // Format new note with prefix and track previous note
  const formatted = `${prefix} ${inputNote} (Previous: ${previousNote ?? 'none'})`;

  // Update storage
  await LocalStorage.setItem('last_saved_note', formatted);

  // Copy to system clipboard
  await Clipboard.copy(formatted);

  // Notify user via HUD
  await showHUD('Note formatted and copied!');

  return formatted;
}

describe('Example Raycast Command End-to-End Execution', () => {
  let mockClipboard: Partial<IClipboardHistoryService>;
  let mockStorage: Partial<IStorageService>;
  let mockFeedback: Partial<IFeedbackService>;
  let memoryStore: Record<string, string>;

  beforeEach(() => {
    memoryStore = {
      last_saved_note: 'Initial note content',
    };

    mockClipboard = {
      writeToClipboard: vi.fn().mockResolvedValue(undefined),
      readCurrentText: vi.fn().mockResolvedValue(''),
    };

    mockStorage = {
      get: vi.fn().mockImplementation(async (k: string) => memoryStore[k] ?? null),
      set: vi.fn().mockImplementation(async (k: string, v: string) => {
        memoryStore[k] = v;
      }),
    };

    mockFeedback = {
      showHUD: vi.fn().mockResolvedValue(undefined),
    };

    setRaycastContext({
      getService: vi.fn().mockImplementation((ns: string) => {
        if (ns === 'clipboard') return mockClipboard;
        if (ns === 'storage') return mockStorage;
        if (ns === 'feedback') return mockFeedback;
        throw new Error(`Unexpected service ${ns}`);
      }),
      preferences: {
        values: {
          notePrefix: '[Asyar Raycast]',
          commands: {},
        },
      },
    } as any);
  });

  it('runs the example command end-to-end and interacts correctly with Asyar services', async () => {
    const result = await copyFormattedNoteCommand('Hello Asyar!');

    expect(result).toBe('[Asyar Raycast] Hello Asyar! (Previous: Initial note content)');

    // Verify storage was updated
    expect(mockStorage.set).toHaveBeenCalledWith(
      'last_saved_note',
      JSON.stringify('[Asyar Raycast] Hello Asyar! (Previous: Initial note content)'),
    );

    // Verify clipboard was invoked
    expect(mockClipboard.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '[Asyar Raycast] Hello Asyar! (Previous: Initial note content)',
      }),
    );

    // Verify HUD notification was shown
    expect(mockFeedback.showHUD).toHaveBeenCalledWith('Note formatted and copied!');
  });
});
