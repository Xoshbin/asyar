import { describe, it, expect } from 'vitest';
import { evaluatePassphraseStrength } from './EncryptionEnrolmentDialog.logic';

describe('evaluatePassphraseStrength', () => {
  it('rejects empty', () => {
    expect(evaluatePassphraseStrength('').accepted).toBe(false);
  });
  it('rejects under 12 chars', () => {
    expect(evaluatePassphraseStrength('short').accepted).toBe(false);
  });
  it('rejects 12 chars but weak', () => {
    expect(evaluatePassphraseStrength('passwordpass').accepted).toBe(false);
  });
  it('accepts strong long passphrase', () => {
    expect(evaluatePassphraseStrength('correct horse battery staple').accepted).toBe(true);
  });
  it('rejects over 256 chars', () => {
    expect(evaluatePassphraseStrength('x'.repeat(257)).accepted).toBe(false);
  });
  it('counts Unicode characters, not UTF-16 code units', () => {
    // Each 🔒 is 1 Unicode char but 2 UTF-16 code units (surrogate pair).
    // A naive `p.length` check would count 6 emojis as 12 chars and silently
    // accept the length gate. The implementation uses [...p].length so 6
    // emojis = 6 chars and the < 12 gate rejects.
    expect(evaluatePassphraseStrength('🔒'.repeat(6)).accepted).toBe(false);
    expect(evaluatePassphraseStrength('🔒'.repeat(6)).reason).toMatch(/Minimum/);
    // Twelve emojis = 12 chars, length gate passes (strength gate may still
    // reject — what matters here is the reason string isn't the length one).
    const r = evaluatePassphraseStrength('🔒'.repeat(12));
    if (!r.accepted) expect(r.reason).not.toMatch(/Minimum/);
  });
});
