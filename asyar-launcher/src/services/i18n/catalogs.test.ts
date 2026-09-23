import { describe, it, expect } from 'vitest';
import enCatalog from '../../locales/en.json';
import ptBRCatalog from '../../locales/pt-BR.json';
import zhCNCatalog from '../../locales/zh-CN.json';
import zhHantCatalog from '../../locales/zh-Hant.json';

/** Interpolation placeholders such as `{title}` must survive translation verbatim. */
function getPlaceholders(value: string): Set<string> {
  return new Set(value.match(/\{[^}]*\}/g) ?? []);
}

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

describe('Translation Catalog Integrity', () => {
  const en = { name: 'en.json', catalog: enCatalog as Record<string, any> };

  // Every translated catalog must mirror en.json's key set. Register new
  // locale files here so the parity assertions below cover them automatically.
  const translatedCatalogs = [
    { name: 'pt-BR.json', catalog: ptBRCatalog as Record<string, any> },
    { name: 'zh-CN.json', catalog: zhCNCatalog as Record<string, any> },
    { name: 'zh-Hant.json', catalog: zhHantCatalog as Record<string, any> },
  ];

  const catalogs = [en, ...translatedCatalogs];

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
      checkLeaves(catalog);
    });
  }

  const enKeys = getKeys(en.catalog);

  for (const { name, catalog } of translatedCatalogs) {
    it(`${name} contains every key from en.json`, () => {
      const keys = getKeys(catalog);

      for (const key of enKeys) {
        expect(keys.has(key), `Missing key in ${name}: ${key}`).toBe(true);
      }
    });

    it(`${name} does not add keys that are absent from en.json`, () => {
      for (const key of getKeys(catalog)) {
        expect(enKeys.has(key), `Unexpected key in ${name}: ${key}`).toBe(true);
      }
    });

    it(`${name} preserves every interpolation placeholder from en.json`, () => {
      function checkPlaceholders(
        enNode: Record<string, any>,
        localizedNode: Record<string, any> | undefined,
        prefix = '',
      ) {
        for (const [key, enValue] of Object.entries(enNode)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;

          if (typeof enValue === 'object' && enValue !== null) {
            checkPlaceholders(enValue, localizedNode?.[key], fullKey);
            continue;
          }

          const localizedValue = localizedNode?.[key];
          if (typeof enValue !== 'string' || typeof localizedValue !== 'string') {
            continue;
          }

          expect(
            [...getPlaceholders(localizedValue)].sort(),
            `Placeholder mismatch in ${name}: ${fullKey}`,
          ).toEqual([...getPlaceholders(enValue)].sort());
        }
      }

      checkPlaceholders(en.catalog, catalog);
    });
  }
});
