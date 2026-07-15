import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./invokeSafe', () => ({
  invokeSafe: vi.fn(),
  invokeSafeVoid: vi.fn(),
  invokeRaw: vi.fn(),
}));

import { invokeRaw } from './invokeSafe';
import { aiListModels } from './commands';

describe('AI commands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates model discovery to Rust and normalizes optional metadata', async () => {
    vi.mocked(invokeRaw).mockResolvedValue([
      { id: 'plain', label: 'Plain', reasoningEfforts: null },
      { id: 'reasoning', label: 'Reasoning', reasoningEfforts: ['low', 'high'] },
    ]);
    const config = { enabled: true, apiKey: 'secret' };

    await expect(aiListModels('openai', config)).resolves.toEqual([
      { id: 'plain', label: 'Plain', reasoningEfforts: undefined },
      { id: 'reasoning', label: 'Reasoning', reasoningEfforts: ['low', 'high'] },
    ]);
    expect(invokeRaw).toHaveBeenCalledWith('ai_list_models', { providerId: 'openai', config });
  });
});
