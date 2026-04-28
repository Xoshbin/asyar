import { describe, it, expect } from 'vitest';
import { validateAlias, normalizeAlias } from './aliasValidation';

describe('aliasValidation', () => {
  it('rejects empty input', () => {
    expect(validateAlias('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateAlias('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects too long', () => {
    expect(validateAlias('abcdefghijk')).toEqual({ ok: false, reason: 'too-long' });
  });

  it('accepts max length (10 chars)', () => {
    expect(validateAlias('abcdefghij')).toEqual({ ok: true, normalized: 'abcdefghij' });
  });

  it('accepts single char', () => {
    expect(validateAlias('a')).toEqual({ ok: true, normalized: 'a' });
    expect(validateAlias('1')).toEqual({ ok: true, normalized: '1' });
  });

  it('rejects invalid chars', () => {
    expect(validateAlias('a-b').ok).toBe(false);
    expect(validateAlias('a b').ok).toBe(false);
    expect(validateAlias('a_b').ok).toBe(false);
    expect(validateAlias('a!').ok).toBe(false);
    expect(validateAlias('café').ok).toBe(false);
  });

  it('lowercases and trims', () => {
    expect(validateAlias('  CL  ')).toEqual({ ok: true, normalized: 'cl' });
    expect(validateAlias('MyAlias')).toEqual({ ok: true, normalized: 'myalias' });
  });

  it('accepts digits', () => {
    expect(validateAlias('1pass')).toEqual({ ok: true, normalized: '1pass' });
    expect(validateAlias('h2o')).toEqual({ ok: true, normalized: 'h2o' });
  });

  it('normalizeAlias is the lowercase + trim only (no validation)', () => {
    expect(normalizeAlias('  Hello!  ')).toBe('hello!');
  });
});
