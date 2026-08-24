import { describe, it, expect, beforeEach } from 'vitest';
import { I18nService } from './i18nService.svelte';

describe('I18nService', () => {
  let i18n: I18nService;

  beforeEach(() => {
    i18n = new I18nService();
    i18n.registerCatalog('en', {
      search: {
        placeholder: 'Search applications...',
        results_count: '{count} results found for {query}',
      },
      common: {
        save: 'Save',
        cancel: 'Cancel',
      },
    });
  });

  it('translates base English keys with dot notation', () => {
    expect(i18n.t('search.placeholder')).toBe('Search applications...');
    expect(i18n.t('common.save')).toBe('Save');
  });

  it('interpolates template parameters correctly', () => {
    const text = i18n.t('search.results_count', { count: 3, query: 'calc' });
    expect(text).toBe('3 results found for calc');
  });

  it('returns the key itself when translation is missing across all catalogs', () => {
    expect(i18n.t('unknown.missing.key')).toBe('unknown.missing.key');
  });

  it('falls back through candidate chain to en when key is missing in active locale', () => {
    i18n.registerCatalog('de', {
      search: {
        placeholder: 'Apps suchen...',
      },
    });

    i18n.setLocale('de-DE');

    // Translated in de:
    expect(i18n.t('search.placeholder')).toBe('Apps suchen...');

    // Missing in de, but exists in en:
    expect(i18n.t('common.save')).toBe('Save');
  });

  it('resolves localized string dictionaries from manifests', () => {
    i18n.setLocale('de-AT');
    i18n.registerCatalog('de', {});

    const map = {
      default: 'Clipboard History',
      de: 'Zwischenablage',
      fr: 'Presse-papiers',
    };

    expect(i18n.resolveLocalized(map)).toBe('Zwischenablage');
    expect(i18n.resolveLocalized('Plain String')).toBe('Plain String');
    expect(i18n.resolveLocalized({ default: 'Fallback Only' })).toBe('Fallback Only');
  });
});
