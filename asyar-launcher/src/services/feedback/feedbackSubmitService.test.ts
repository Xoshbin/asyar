import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { feedbackSubmitService } from './feedbackSubmitService';
import { invoke } from '@tauri-apps/api/core';

describe('feedbackSubmitService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes submit_feedback with the input', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await feedbackSubmitService.submit({
      type: 'feedback',
      category: 'idea',
      message: 'great app',
      email: 'me@example.com',
    });

    expect(invoke).toHaveBeenCalledWith('submit_feedback', {
      input: {
        type: 'feedback',
        category: 'idea',
        message: 'great app',
        email: 'me@example.com',
      },
    });
  });

  it('throws when submit_feedback fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('network'));
    await expect(feedbackSubmitService.submit({ type: 'crash' })).rejects.toThrow();
  });
});
