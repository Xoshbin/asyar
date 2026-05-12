import { describe, it, expect } from 'vitest';
import { isAiHintVisible, type AiHintVisibilityArgs } from './aiHintVisibility';

const aiHint = { type: 'ai' };
const prefixHint = { type: 'prefix' };

function args(overrides: Partial<AiHintVisibilityArgs> = {}): AiHintVisibilityArgs {
  return {
    contextHint: aiHint,
    activeContext: null,
    argumentModeActive: false,
    viewActive: false,
    diagnosticActive: false,
    ...overrides,
  };
}

describe('isAiHintVisible', () => {
  it('returns true when AI hint present and no conflicting state active', () => {
    // stub returns false → FAILS (RED)
    expect(isAiHintVisible(args())).toBe(true);
  });

  it('returns false when argument mode is active', () => {
    expect(isAiHintVisible(args({ argumentModeActive: true }))).toBe(false);
  });

  it('returns false when a Tier 2 view is active', () => {
    expect(isAiHintVisible(args({ viewActive: true }))).toBe(false);
  });

  it('returns false when a context (portal/script chip) is already committed', () => {
    expect(isAiHintVisible(args({ activeContext: { provider: { id: 'portal-google' }, query: '' } }))).toBe(false);
  });

  it('returns false when a diagnostic bar is active', () => {
    expect(isAiHintVisible(args({ diagnosticActive: true }))).toBe(false);
  });

  it('returns false when contextHint is null (no hint of any kind)', () => {
    expect(isAiHintVisible(args({ contextHint: null }))).toBe(false);
  });

  it('returns false when contextHint type is not "ai" (prefix hint, not AI hint)', () => {
    expect(isAiHintVisible(args({ contextHint: prefixHint }))).toBe(false);
  });
});
