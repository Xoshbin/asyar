import { describe, it, expect } from 'vitest';
import { HELP_TOPICS, GUIDE_BASE_URL, guideUrl, filterTopics } from './topics';

describe('help topics', () => {
  it('has a topic per built-in plus the two intro pages', () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(ids).toContain('getting-started');
    expect(ids).toContain('the-basics');
    expect(ids).toContain('calculator');
    expect(ids).toContain('ai-and-agents');
    // every topic is fully formed
    for (const t of HELP_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.icon.startsWith('icon:')).toBe(true);
      expect(t.slug.length).toBeGreaterThan(0);
    }
  });

  it('builds an absolute guide URL from a slug', () => {
    expect(guideUrl('features/calculator')).toBe(`${GUIDE_BASE_URL}/features/calculator`);
  });

  it('filters topics case-insensitively by title and subtitle', () => {
    expect(filterTopics(HELP_TOPICS, 'clip').map((t) => t.id)).toContain('clipboard-history');
    expect(filterTopics(HELP_TOPICS, 'PASTE').some((t) => t.id === 'clipboard-history')).toBe(true);
  });

  it('returns all topics for an empty query', () => {
    expect(filterTopics(HELP_TOPICS, '')).toHaveLength(HELP_TOPICS.length);
    expect(filterTopics(HELP_TOPICS, '   ')).toHaveLength(HELP_TOPICS.length);
  });
});
