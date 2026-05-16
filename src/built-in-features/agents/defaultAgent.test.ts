import { describe, it, expect } from 'vitest';
import {
  OOTB_DEFAULT_AGENT_SYSTEM_PROMPT,
  buildDefaultAgentInput,
  buildGrammarFixAgentInput,
  GRAMMAR_FIX_SYSTEM_PROMPT,
} from './defaultAgent';

const LOCKED_SYSTEM_PROMPT =
  'You are Asyar Assistant, a friendly and helpful AI built into the Asyar launcher. ' +
  'Help the user with quick questions, explanations, drafting, summarizing, and general thinking-through. ' +
  'Be concise, accurate, and direct. If you don\'t know something, say so. ' +
  'Use Markdown for code and lists when it improves clarity.';

describe('defaultAgent', () => {
  it('exports the locked system prompt', () => {
    expect(OOTB_DEFAULT_AGENT_SYSTEM_PROMPT).toBe(LOCKED_SYSTEM_PROMPT);
  });

  it('returns the locked agent shape', () => {
    const input = buildDefaultAgentInput('openai', 'gpt-4o-mini');
    expect(input.name).toBe('Asyar Assistant');
    expect(typeof input.description).toBe('string');
    expect((input.description as string).length).toBeLessThanOrEqual(80);
    expect(input.systemPrompt).toBe(OOTB_DEFAULT_AGENT_SYSTEM_PROMPT);
    expect(input.providerId).toBe('openai');
    expect(input.modelId).toBe('gpt-4o-mini');
    expect(input.toolSelection).toEqual([]);
  });

  it('uses empty toolSelection so first-launch is fast', () => {
    const input = buildDefaultAgentInput('anthropic', 'claude-3-5-haiku-20241022');
    expect(input.toolSelection).toEqual([]);
  });
});

describe('buildGrammarFixAgentInput', () => {
  it('returns a silent agent configured for selection->replaceSelection', () => {
    const input = buildGrammarFixAgentInput('openai', 'gpt-4o-mini');
    expect(input.name).toBe('Grammar Fix');
    expect(input.silent).toBe(true);
    expect(input.inputSource).toBe('selection');
    expect(input.outputAction).toBe('replaceSelection');
    expect(input.systemPrompt).toBe(GRAMMAR_FIX_SYSTEM_PROMPT);
    expect(input.toolSelection).toEqual([]);
  });

  it('passes through provider and model', () => {
    const input = buildGrammarFixAgentInput('anthropic', 'claude-3-5-haiku-20241022');
    expect(input.providerId).toBe('anthropic');
    expect(input.modelId).toBe('claude-3-5-haiku-20241022');
  });
});
