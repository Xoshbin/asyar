import { describe, it, expect } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';
import zhCN from './zh-CN.json';
import zhHant from './zh-Hant.json';

function getLeafKeys(obj: Record<string, any>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...getLeafKeys(value, fullPath));
    } else {
      keys.push(fullPath);
    }
  }
  return keys;
}

describe('i18n locale parity for E2EE keys', () => {
  const enKeys = new Set(getLeafKeys(en));
  const ptBRKeys = new Set(getLeafKeys(ptBR));
  const zhCNKeys = new Set(getLeafKeys(zhCN));
  const zhHantKeys = new Set(getLeafKeys(zhHant));

  const e2eeKeys = Array.from(enKeys).filter(
    (k) => k.startsWith('settings.e2ee.') || k.startsWith('settings.account.'),
  );

  it('all settings.e2ee and settings.account keys in en.json exist in pt-BR.json', () => {
    const missing = e2eeKeys.filter((k) => !ptBRKeys.has(k));
    expect(missing, `Missing keys in pt-BR.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('all settings.e2ee and settings.account keys in en.json exist in zh-CN.json', () => {
    const missing = e2eeKeys.filter((k) => !zhCNKeys.has(k));
    expect(missing, `Missing keys in zh-CN.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('all settings.e2ee and settings.account keys in en.json exist in zh-Hant.json', () => {
    const missing = e2eeKeys.filter((k) => !zhHantKeys.has(k));
    expect(missing, `Missing keys in zh-Hant.json:\n${missing.join('\n')}`).toEqual([]);
  });
});
