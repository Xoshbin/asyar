import { describe, it, expect } from 'vitest';
import enCatalog from '../../locales/en.json';

describe('Translation Catalog Integrity', () => {
  it('en.json is a valid non-empty object', () => {
    expect(enCatalog).toBeDefined();
    expect(typeof enCatalog).toBe('object');
    expect(Object.keys(enCatalog).length).toBeGreaterThan(0);
  });

  it('contains mandatory top-level namespaces', () => {
    expect(enCatalog).toHaveProperty('search');
    expect(enCatalog).toHaveProperty('actions');
    expect(enCatalog).toHaveProperty('settings');
    expect(enCatalog).toHaveProperty('features');
    expect(enCatalog).toHaveProperty('common');
  });

  it('all leaves are non-empty strings', () => {
    function checkLeaves(obj: Record<string, any>, prefix = '') {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
          checkLeaves(value, fullKey);
        } else {
          expect(typeof value, `Expected leaf "${fullKey}" to be a string`).toBe('string');
          expect(
            (value as string).trim().length,
            `Expected leaf "${fullKey}" to not be empty`,
          ).toBeGreaterThan(0);
        }
      }
    }

    checkLeaves(enCatalog);
  });
});
