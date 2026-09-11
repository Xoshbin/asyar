import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn() }));
vi.mock('../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));
import { writeText } from 'tauri-plugin-clipboard-x-api';
import { feedbackService } from '../services/feedback/feedbackService.svelte';
import { copyText } from './copyText';

describe('copyText', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reports success only after the native clipboard write resolves', async () => {
    let resolve!: () => void;
    vi.mocked(writeText).mockReturnValueOnce(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    const result = copyText('**Full message**\nwith code');
    expect(writeText).toHaveBeenCalledWith('**Full message**\nwith code');
    expect(feedbackService.report).not.toHaveBeenCalled();
    resolve();
    expect(await result).toBe(true);
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success' }),
    );
  });
  it('reports a safe failure and allows retry', async () => {
    vi.mocked(writeText).mockRejectedValueOnce(new Error('secret content'));
    expect(await copyText('private output')).toBe(false);
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
    expect(JSON.stringify(vi.mocked(feedbackService.report).mock.calls)).not.toMatch(
      /secret content|private output/,
    );
    vi.mocked(writeText).mockResolvedValueOnce(undefined);
    expect(await copyText('private output')).toBe(true);
  });
});
