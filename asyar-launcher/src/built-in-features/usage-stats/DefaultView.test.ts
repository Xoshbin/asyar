/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('../../services/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../components', async () => ({
  AppBar: (await import('../../components/layout/AppBar.svelte')).default,
  Card: (await import('../../components/layout/Card.svelte')).default,
  EmptyState: (await import('../../components/feedback/EmptyState.svelte')).default,
  StatTile: (await import('../../components/base/StatTile.svelte')).default,
  RankedStatRow: (await import('../../components/list/RankedStatRow.svelte')).default,
}));
vi.mock('./usageStatsState.svelte', () => ({
  usageStatsState: {
    stats: { totalLaunches: 0, activeDays: 0, top: [] },
    aiUsage: {
      totals: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 10 },
      byModel: [
        {
          providerId: 'openai',
          modelId: 'gpt-test',
          totals: { inputTokens: 100, outputTokens: 50 },
        },
      ],
    },
    load: vi.fn().mockResolvedValue(undefined),
  },
}));

import DefaultView from './DefaultView.svelte';

describe('Usage Stats AI section', () => {
  it('shows AI totals and provider-model rows even when no launch history exists', () => {
    const { getByText } = render(DefaultView);
    expect(getByText('features.usage_stats.ui.ai_tokens_30_days')).toBeTruthy();
    expect(getByText('100')).toBeTruthy();
    expect(getByText('50')).toBeTruthy();
    expect(getByText('30')).toBeTruthy();
    expect(getByText('openai · gpt-test')).toBeTruthy();
  });
});
