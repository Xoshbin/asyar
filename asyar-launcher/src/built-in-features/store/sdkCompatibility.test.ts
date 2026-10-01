import { describe, it, expect } from 'vitest';
import { isSdkCompatible } from './sdkCompatibility';

describe('isSdkCompatible', () => {
  const currentSdk = '4.13.0';

  it('accepts compatible caret ranges', () => {
    expect(isSdkCompatible('^4.10.0', currentSdk)).toBe(true);
    expect(isSdkCompatible('^4.13.0', currentSdk)).toBe(true);
    expect(isSdkCompatible('^4.0.0', currentSdk)).toBe(true);
  });

  it('rejects incompatible major versions', () => {
    expect(isSdkCompatible('^5.0.0', currentSdk)).toBe(false);
    expect(isSdkCompatible('^3.0.0', currentSdk)).toBe(false);
    expect(isSdkCompatible('>=5.0.0', currentSdk)).toBe(false);
  });

  it('rejects incompatible minor bumps on 0.x versions', () => {
    expect(isSdkCompatible('^0.3.0', '0.2.5')).toBe(false);
    expect(isSdkCompatible('^0.2.6', '0.2.5')).toBe(false);
  });

  it('accepts compatible minor and patch bumps on 0.x versions', () => {
    expect(isSdkCompatible('^0.2.0', '0.2.5')).toBe(true);
    expect(isSdkCompatible('^0.2.5', '0.2.5')).toBe(true);
    expect(isSdkCompatible('~0.2.0', '0.2.4')).toBe(true);
  });

  it('handles greater-than and greater-than-or-equal ranges', () => {
    expect(isSdkCompatible('>=4.15.0', currentSdk)).toBe(false);
    expect(isSdkCompatible('>4.13.0', currentSdk)).toBe(false);
    expect(isSdkCompatible('>=4.12.0', currentSdk)).toBe(true);
    expect(isSdkCompatible('>=4.13.0', currentSdk)).toBe(true);
    expect(isSdkCompatible('>4.10.0', currentSdk)).toBe(true);
  });

  it('handles exact versions and tilde ranges', () => {
    expect(isSdkCompatible('4.13.0', currentSdk)).toBe(true);
    expect(isSdkCompatible('4.14.0', currentSdk)).toBe(false);
    expect(isSdkCompatible('~4.13.0', '4.13.5')).toBe(true);
    expect(isSdkCompatible('~4.12.0', currentSdk)).toBe(false);
  });

  it('returns true when requiredRange is null, undefined, or empty', () => {
    expect(isSdkCompatible(null, currentSdk)).toBe(true);
    expect(isSdkCompatible(undefined, currentSdk)).toBe(true);
    expect(isSdkCompatible('', currentSdk)).toBe(true);
    expect(isSdkCompatible('   ', currentSdk)).toBe(true);
  });

  it('treats invalid or unparseable ranges as non-blocking (unknown)', () => {
    expect(isSdkCompatible('invalid-semver', currentSdk)).toBe(true);
    expect(isSdkCompatible('not a range', currentSdk)).toBe(true);
  });
});
