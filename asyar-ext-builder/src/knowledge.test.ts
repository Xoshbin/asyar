import { describe, it, expect } from 'bun:test';
import { knowledgeSources, validateSources, knowledgePromptSection } from './knowledge';

describe('knowledgeSources registry', () => {
  it('has examples and docs arrays of https urls', () => {
    expect(Array.isArray(knowledgeSources.examples)).toBe(true);
    expect(Array.isArray(knowledgeSources.docs)).toBe(true);
    expect(knowledgeSources.examples.length).toBeGreaterThan(0);
    for (const u of [...knowledgeSources.examples, ...knowledgeSources.docs]) {
      expect(u.startsWith('https://')).toBe(true);
    }
  });

  it('validateSources passes for the real registry', () => {
    expect(() => validateSources(knowledgeSources)).not.toThrow();
  });

  it('validateSources rejects non-https, traversal, missing keys, non-array', () => {
    expect(() => validateSources({ examples: ['http://x'], docs: [] })).toThrow();
    expect(() => validateSources({ examples: ['https://x/../y'], docs: [] })).toThrow();
    expect(() => validateSources({ examples: [] })).toThrow();
    expect(() => validateSources({ examples: 'nope', docs: [] })).toThrow();
    expect(() => validateSources(null)).toThrow();
  });
});

describe('knowledgePromptSection', () => {
  it('renders every registry url and the fetch/fallback guidance', () => {
    const text = knowledgePromptSection();
    for (const u of [...knowledgeSources.examples, ...knowledgeSources.docs]) {
      expect(text).toContain(u);
    }
    expect(text).toContain('WebFetch');
    expect(text).toContain('If a URL is unreachable');
  });
});
