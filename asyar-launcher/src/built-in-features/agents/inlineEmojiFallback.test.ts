import { describe, it, expect } from 'vitest';
import { buildEmojiFallbackAgent } from './defaultAgent';

describe('emoji-fallback agent', () => {
  const PROVIDER_ID = 'anthropic';
  const MODEL_ID = 'claude-haiku-4-5-20251001';

  it('id is "emoji-fallback"', () => {
    const a = buildEmojiFallbackAgent(PROVIDER_ID, MODEL_ID);
    expect(a.id).toBe('emoji-fallback');
  });

  it('runs silently with paste output action', () => {
    const a = buildEmojiFallbackAgent(PROVIDER_ID, MODEL_ID);
    expect(a.silent).toBe(true);
    expect(a.outputAction).toBe('paste');
  });

  it('takes its input from the argument (the inner word) not the selection', () => {
    const a = buildEmojiFallbackAgent(PROVIDER_ID, MODEL_ID);
    expect(a.inputSource).toBe('argument');
  });

  it('selects only the org.asyar.emoji:emoji_find tool', () => {
    const a = buildEmojiFallbackAgent(PROVIDER_ID, MODEL_ID);
    expect(a.toolSelection).toEqual(['org.asyar.emoji:emoji_find']);
  });

  it('system prompt instructs single-emoji-or-empty output', () => {
    const a = buildEmojiFallbackAgent(PROVIDER_ID, MODEL_ID);
    expect(a.systemPrompt).toMatch(/exactly one emoji/i);
    expect(a.systemPrompt).toMatch(/empty/i);
  });

  it('uses the caller-provided provider and model', () => {
    const a = buildEmojiFallbackAgent(PROVIDER_ID, MODEL_ID);
    expect(a.providerId).toBe(PROVIDER_ID);
    expect(a.modelId).toBe(MODEL_ID);
  });
});
