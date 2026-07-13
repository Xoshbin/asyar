import { describe, it, expect } from 'vitest';
import { encodeToolIdForWire } from './IProviderPlugin';

// ── encodeToolIdForWire — wire-name encoder for provider tool-name regexes ────

describe('encodeToolIdForWire', () => {
  it('encodes the colon in builtin FQIDs', () => {
    expect(encodeToolIdForWire('builtin:calculator')).toBe('builtin__calculator');
  });

  it('encodes both dots and colons in Tier 2 FQIDs', () => {
    expect(encodeToolIdForWire('ext.foo:bar')).toBe('ext--foo__bar');
  });

  it('produces only chars allowed by Anthropic tool-name regex', () => {
    const allowed = /^[a-zA-Z0-9_-]+$/;
    expect(encodeToolIdForWire('builtin:calculator')).toMatch(allowed);
    expect(encodeToolIdForWire('ext.foo:bar')).toMatch(allowed);
    expect(encodeToolIdForWire('ext.scope.deep:tool-name')).toMatch(allowed);
  });

  it('is a no-op for ids that are already wire-safe', () => {
    expect(encodeToolIdForWire('plain_id')).toBe('plain_id');
    expect(encodeToolIdForWire('with-hyphen')).toBe('with-hyphen');
  });
});
