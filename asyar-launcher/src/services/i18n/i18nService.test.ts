import { describe, it, expect, beforeEach } from 'vitest';
import { I18nService, computeCandidates } from './i18nService.svelte';

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

  it('resolves pt-BR catalog when locale is pt-BR or pt', () => {
    const service = new I18nService('pt-BR');
    expect(service.t('search.placeholder')).toBe('Pesquisar aplicativos e comandos...');

    service.setLocale('pt');
    expect(service.t('search.placeholder')).toBe('Pesquisar aplicativos e comandos...');
  });

  describe('Chinese locale resolution', () => {
    const SIMPLIFIED = '搜索应用与命令……';
    const TRADITIONAL = '搜尋應用程式與命令……';

    it.each(['zh-CN', 'zh-Hans', 'zh-Hans-CN', 'zh', 'zh-SG'])(
      'resolves the Simplified Chinese catalog for %s',
      (locale) => {
        const service = new I18nService(locale);
        expect(service.t('search.placeholder')).toBe(SIMPLIFIED);
      },
    );

    it.each(['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW'])(
      'resolves the Traditional Chinese catalog for %s',
      (locale) => {
        const service = new I18nService(locale);
        expect(service.t('search.placeholder')).toBe(TRADITIONAL);
      },
    );

    it('never lets one Chinese script resolve to the other', () => {
      for (const locale of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW']) {
        const candidates = computeCandidates(locale);
        expect(candidates, `${locale} must reach zh-Hant`).toContain('zh-Hant');

        for (const forbidden of ['zh-CN', 'zh-Hans', 'zh']) {
          expect(candidates, `${locale} must not reach ${forbidden}`).not.toContain(forbidden);
        }
      }

      for (const locale of ['zh-CN', 'zh-Hans', 'zh-Hans-CN', 'zh', 'zh-SG']) {
        expect(computeCandidates(locale), `${locale} must not reach zh-Hant`).not.toContain(
          'zh-Hant',
        );
      }
    });

    it('keeps the script subtag while reducing region-qualified tags', () => {
      expect(computeCandidates('zh-Hans-CN')).toEqual(['zh-Hans-CN', 'zh-Hans', 'zh', 'en']);
      expect(computeCandidates('zh-CN')).toEqual(['zh-CN', 'zh', 'zh-Hans', 'en']);
      expect(computeCandidates('zh-TW')).toEqual(['zh-TW', 'zh-Hant', 'en']);
      expect(computeCandidates('zh-Hant')).toEqual(['zh-Hant', 'en']);
      expect(computeCandidates('zh-Hant-TW')).toEqual(['zh-Hant-TW', 'zh-Hant', 'en']);
    });
  });

  describe('POSIX locale tag normalization', () => {
    it.each([
      ['zh_CN.UTF-8', ['zh-CN', 'zh', 'zh-Hans', 'en']],
      ['zh_TW.UTF-8', ['zh-TW', 'zh-Hant', 'en']],
      ['pt_BR.UTF-8', ['pt-BR', 'pt', 'pt-Latn', 'en']],
      ['en_US.UTF-8', ['en-US', 'en', 'en-Latn']],
      ['zh_CN@pinyin', ['zh-CN', 'zh', 'zh-Hans', 'en']],
    ])('normalizes %s into clean BCP-47 candidate chain', (raw, expected) => {
      expect(computeCandidates(raw)).toEqual(expected);
    });

    it('resolves correct translation from POSIX locale string', () => {
      const service = new I18nService('zh_CN.UTF-8');
      expect(service.t('search.placeholder')).toBe('搜索应用与命令……');

      service.setLocale('zh_TW.UTF-8');
      expect(service.t('search.placeholder')).toBe('搜尋應用程式與命令……');
    });
  });
});
