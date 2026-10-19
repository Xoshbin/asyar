import { describe, it, expect } from 'vitest';
import { canAddRoot, canAddExcludePattern, withRootSearchEnabled } from './fileSearchTab.helpers';

describe('canAddRoot', () => {
  it('rejects empty input', () => {
    expect(canAddRoot('', [])).toBe(false);
    expect(canAddRoot('   ', [])).toBe(false);
  });

  it('rejects a duplicate of an existing root', () => {
    expect(canAddRoot('/data', ['/data'])).toBe(false);
  });

  it('accepts a new, non-empty, non-duplicate path', () => {
    expect(canAddRoot('/data', ['/other'])).toBe(true);
  });
});

describe('withRootSearchEnabled', () => {
  it('flips the root-search toggle without changing any other field', () => {
    const config = {
      enabled: true,
      rootSearchEnabled: true,
      includeRoots: ['/data'],
      excludePatterns: ['*.tmp'],
      indexHidden: false,
    };

    expect(withRootSearchEnabled(config, false)).toEqual({
      ...config,
      rootSearchEnabled: false,
    });
  });
});

describe('canAddExcludePattern', () => {
  it('rejects empty or whitespace-only input', () => {
    expect(canAddExcludePattern('', [])).toBe(false);
    expect(canAddExcludePattern('   ', [])).toBe(false);
  });

  it('rejects a duplicate of the trimmed existing pattern', () => {
    expect(canAddExcludePattern('node_modules', ['node_modules'])).toBe(false);
    expect(canAddExcludePattern('  node_modules  ', ['node_modules'])).toBe(false);
  });

  it('accepts a new pattern', () => {
    expect(canAddExcludePattern('*.tmp', ['node_modules'])).toBe(true);
  });
});
