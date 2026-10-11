import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./invokeSafe', () => ({ invokeSafe: vi.fn() }));
import { invokeSafe } from './invokeSafe';
import { aiUsageSummary } from './aiUsageCommands';

describe('AI usage commands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requests a Rust-aggregated summary with the since timestamp', async () => {
    const summary = { totals: { inputTokens: 10, outputTokens: 5 }, byModel: [] };
    vi.mocked(invokeSafe).mockResolvedValueOnce(summary);
    await expect(aiUsageSummary(1234)).resolves.toEqual(summary);
    expect(invokeSafe).toHaveBeenCalledWith('ai_usage_summary', { sinceMs: 1234 });
  });
});
