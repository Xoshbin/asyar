import enCatalog from '../../locales/en.json';
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

export function computeCandidates(locale: string): string[] {
  const normalized = locale.trim().replace(/_/g, '-');
  const candidates: string[] = [];
  if (normalized) {
    candidates.push(normalized);
    const parts = normalized.split('-');
    if (parts.length > 1) {
      candidates.push(parts[0]);
    }
  }
  if (!candidates.includes('en')) {
    candidates.push('en');
  }
  return candidates;
}

export class I18nService {
  locale = $state<string>('en');
  private catalogs = $state<Map<string, Record<string, any>>>(new Map());

  constructor(defaultLocale: string = 'en') {
    this.locale = defaultLocale;
    this.catalogs.set('en', enCatalog as Record<string, any>);
  }

  registerCatalog(locale: string, catalog: Record<string, any>): void {
    const norm = locale.trim().replace(/_/g, '-');
    const existing = this.catalogs.get(norm) ?? {};
    this.catalogs.set(norm, { ...existing, ...catalog });
  }

  setLocale(locale: string): void {
    this.locale = locale.trim().replace(/_/g, '-');
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
