import { describe, it, expect } from 'vitest';
import { looksLikeAIIntent } from './aiHintIntensity';

describe('looksLikeAIIntent', () => {
  it('returns false for empty string', () => {
    expect(looksLikeAIIntent('')).toBe(false);
  });

  it('returns false for plain single word like "settings"', () => {
    expect(looksLikeAIIntent('settings')).toBe(false);
  });

  it('returns true for a natural-language question ending with ?', () => {
    // stub returns false → FAILS (RED)
    expect(looksLikeAIIntent('why is the sky blue?')).toBe(true);
  });

  it('returns true for a multi-word AI-directed phrase', () => {
    // stub returns false → FAILS (RED)
    expect(looksLikeAIIntent('explain rust ownership')).toBe(true);
  });

  it('returns false for a single ambiguous word', () => {
    expect(looksLikeAIIntent('what')).toBe(false);
  });

  it('returns true for a how-to phrase with >=3 words', () => {
    // stub returns false → FAILS (RED)
    expect(looksLikeAIIntent('how do I write a Rust trait')).toBe(true);
  });
});
