import { describe, it, expect } from 'vitest';
import enCatalog from '../../locales/en.json';
import ptBRCatalog from '../../locales/pt-BR.json';

describe('Translation Catalog Integrity', () => {
  const catalogs = [
    { name: 'en.json', catalog: enCatalog },
    { name: 'pt-BR.json', catalog: ptBRCatalog },
  ];

  for (const { name, catalog } of catalogs) {
    it(`${name} is a valid non-empty object`, () => {
      expect(catalog).toBeDefined();
      expect(typeof catalog).toBe('object');
      expect(Object.keys(catalog).length).toBeGreaterThan(0);
    });

    it(`${name} contains mandatory top-level namespaces`, () => {
      expect(catalog).toHaveProperty('search');
      expect(catalog).toHaveProperty('actions');
      expect(catalog).toHaveProperty('settings');
      expect(catalog).toHaveProperty('features');
      expect(catalog).toHaveProperty('common');
    });

    it(`${name} all leaves are non-empty strings`, () => {
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

      checkLeaves(catalog);
    });
  }

  it('pt-BR.json contains all keys from en.json', () => {
    function getKeys(obj: Record<string, any>, prefix = ''): Set<string> {
      const keys = new Set<string>();
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
          for (const subKey of getKeys(value, fullKey)) {
            keys.add(subKey);
          }
        } else {
          keys.add(fullKey);
        }
      }
      return keys;
    }

    const enKeys = getKeys(enCatalog);
    const ptKeys = getKeys(ptBRCatalog);

    for (const key of enKeys) {
      expect(ptKeys.has(key), `Missing key in pt-BR.json: ${key}`).toBe(true);
    }
  });
});
