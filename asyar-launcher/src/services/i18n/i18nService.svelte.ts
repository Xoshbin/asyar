import enCatalog from '../../locales/en.json';
import ptBRCatalog from '../../locales/pt-BR.json';
import zhCNCatalog from '../../locales/zh-CN.json';
import zhHantCatalog from '../../locales/zh-Hant.json';
import { getSystemLocale } from '../../lib/ipc/commands';

function getNestedValue(obj: Record<string, any>, path: string): string | undefined {
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * CLDR likely script for a BCP-47 tag (`zh` -> `Hans`, `zh-TW` -> `Hant`).
 *
 * Returns `undefined` when the runtime cannot resolve one, in which case the
 * fallback chain degrades to plain RFC 4647 truncation.
 */
function getLikelyScript(tag: string): string | undefined {
  if (typeof Intl.Locale !== 'function') {
    return undefined;
  }
  try {
    return new Intl.Locale(tag).maximize().script;
  } catch {
    return undefined;
  }
}

/**
 * Builds the fallback chain for a BCP-47 tag, always ending with `en`.
 *
 * Subtags are dropped one at a time (RFC 4647 lookup), but never in a way that
 * silently switches the script of the request. Script subtags are what
 * distinguish languages sharing a base tag (`zh-Hans` vs `zh-Hant`), so
 * `zh-Hant-TW` must never collapse onto the bare `zh` tag, whose CLDR default
 * content is Simplified Chinese.
 *
 * When dropping a subtag would switch the script, the script-qualified form is
 * used instead, so that region-only tags still reach the right catalog:
 * `zh-TW` -> `zh-Hant`, while `zh-Hans-CN` -> `zh-Hans`.
 *
 * A bare language tag additionally probes its likely script form (`zh` ->
 * `zh-Hans`) so script-qualified catalogs stay reachable without registering a
 * macrolanguage alias that would swallow the other script.
 */
function normalizeLocaleTag(tag: string): string {
  return tag.trim().replace(/\..*$/, '').replace(/@.*$/, '').replace(/_/g, '-');
}

export function computeCandidates(locale: string): string[] {
  const normalized = normalizeLocaleTag(locale);
  const candidates: string[] = [];

  const add = (candidate: string) => {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  if (normalized) {
    const parts = normalized.split('-').filter(Boolean);
    const requestedScript = getLikelyScript(normalized);

    for (let length = parts.length; length >= 1; length--) {
      const candidate = parts.slice(0, length).join('-');
      const candidateScript = getLikelyScript(candidate);
      const keepsScript = !requestedScript || candidateScript === requestedScript;

      if (length === parts.length || keepsScript) {
        add(candidate);

        // A bare language tag carries no script subtag of its own; probe its
        // CLDR default script form as well.
        if (length === 1 && candidateScript) {
          add(`${candidate}-${candidateScript}`);
        }
      } else {
        // Reducing any further would switch the script (`zh-TW` reduces to
        // `zh`, which means `zh-Hans`). Keep the requested script by falling
        // back to its script-qualified form instead.
        add(`${candidate}-${requestedScript}`);
      }
    }
  }

  add('en');

  return candidates;
}

export class I18nService {
  locale = $state<string>('en');
  private catalogs = $state<Map<string, Record<string, any>>>(new Map());

  constructor(defaultLocale: string = 'en') {
    this.locale = defaultLocale;
    this.catalogs.set('en', enCatalog as Record<string, any>);
    // Portuguese is not script-split, so a macrolanguage alias is unambiguous.
    this.catalogs.set('pt-BR', ptBRCatalog as Record<string, any>);
    this.catalogs.set('pt', ptBRCatalog as Record<string, any>);
    // Chinese is script-split (Hans vs Hant), so each script gets its own
    // catalog and neither is registered under the bare `zh` tag: that alias
    // would make one script serve the other's locales. Region-only tags such
    // as zh-TW and zh-HK reach `zh-Hant` through the fallback chain instead.
    this.catalogs.set('zh-CN', zhCNCatalog as Record<string, any>);
    this.catalogs.set('zh-Hans', zhCNCatalog as Record<string, any>);
    this.catalogs.set('zh-Hant', zhHantCatalog as Record<string, any>);
  }

  registerCatalog(locale: string, catalog: Record<string, any>): void {
    const norm = normalizeLocaleTag(locale);
    const existing = this.catalogs.get(norm) ?? {};
    this.catalogs.set(norm, { ...existing, ...catalog });
  }

  setLocale(locale: string): void {
    this.locale = normalizeLocaleTag(locale);
  }

  t(key: string, params?: Record<string, string | number>): string {
    const candidates = computeCandidates(this.locale);
    let template: string | undefined;

    for (const cand of candidates) {
      const catalog = this.catalogs.get(cand);
      if (catalog) {
        template = getNestedValue(catalog, key);
        if (template !== undefined) {
          break;
        }
      }
    }

    if (template === undefined) {
      template = key;
    }

    if (!params) {
      return template;
    }

    return template.replace(/\{(\w+)\}/g, (match, paramKey) => {
      const val = params[paramKey];
      return val !== undefined ? String(val) : match;
    });
  }

  resolveLocalized(
    value: string | Record<string, string> | undefined | null,
    fallback: string = '',
  ): string {
    if (!value) {
      return fallback;
    }
    if (typeof value === 'string') {
      return value;
    }
    const candidates = computeCandidates(this.locale);
    for (const cand of candidates) {
      if (value[cand] !== undefined) {
        return value[cand];
      }
    }
    return value.default ?? value.en ?? Object.values(value)[0] ?? fallback;
  }

  async init(): Promise<void> {
    try {
      const systemLocale = await getSystemLocale();
      if (systemLocale?.raw) {
        this.setLocale(systemLocale.raw);
      }
    } catch {
      // Keep default 'en'
    }
  }
}

export const i18nService = new I18nService();
export const t = (key: string, params?: Record<string, string | number>) =>
  i18nService.t(key, params);
