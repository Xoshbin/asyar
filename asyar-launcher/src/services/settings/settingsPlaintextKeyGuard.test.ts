import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ProviderConfig } from '../ai/IProviderPlugin';
import type { WebSearchSettings } from './types/AppSettingsType';
import type {
  ProviderConfig as BindingsProviderConfig,
  WebSearchConfig as BindingsWebSearchConfig,
} from '../../bindings';

// Type-level assertion helper: produces type error if T contains K
type ExpectNoKey<T, K extends string> = K extends keyof T ? false : true;

describe('Plaintext apiKey guard', () => {
  it('ensures ProviderConfig type does not contain apiKey', () => {
    type Test1 = ExpectNoKey<ProviderConfig, 'apiKey'>;
    const assert1: Test1 = true;
    expect(assert1).toBe(true);

    type Test2 = ExpectNoKey<BindingsProviderConfig, 'apiKey'>;
    const assert2: Test2 = true;
    expect(assert2).toBe(true);
  });

  it('ensures WebSearchSettings and WebSearchConfig do not contain apiKey', () => {
    type Test1 = ExpectNoKey<WebSearchSettings, 'apiKey'>;
    const assert1: Test1 = true;
    expect(assert1).toBe(true);

    type Test2 = ExpectNoKey<BindingsWebSearchConfig, 'apiKey'>;
    const assert2: Test2 = true;
    expect(assert2).toBe(true);
  });

  it('ensures default AI settings have no apiKey anywhere', async () => {
    const { settingsService } = await import('./settingsService.svelte');
    const aiDefaults = settingsService.currentSettings.ai;

    for (const [_providerId, config] of Object.entries(aiDefaults.providers)) {
      expect(config).not.toHaveProperty('apiKey');
    }

    if (aiDefaults.webSearch) {
      expect(aiDefaults.webSearch).not.toHaveProperty('apiKey');
    }
  });

  it('ensures sanitizeIncomingAiSettings strips any legacy apiKey before persistence', async () => {
    const { sanitizeIncomingAiSettings } =
      await import('../profile/providers/aiSettingsSyncProvider');

    const incomingWithLeakedKey = {
      providers: {
        openai: {
          enabled: true,
          apiKey: 'sk-leaked-key',
          lastModelId: 'gpt-4o',
        },
      },
      webSearch: {
        engine: 'brave',
        apiKey: 'bsa-leaked-key',
      },
    };

    const sanitized = sanitizeIncomingAiSettings(incomingWithLeakedKey as any, undefined);
    // Remote providers are completely stripped
    expect(sanitized.providers).toBeUndefined();
    // Web search has apiKey stripped
    expect(sanitized.webSearch).not.toHaveProperty('apiKey');
    expect(JSON.stringify(sanitized)).not.toContain('apiKey');
    expect(JSON.stringify(sanitized)).not.toContain('sk-leaked-key');
    expect(JSON.stringify(sanitized)).not.toContain('bsa-leaked-key');
  });

  it('keeps `apiKey` out of non-test source except the audited legacy-scrubbing sites', () => {
    const srcRoot = join(__dirname, '..', '..');
    // Files that legitimately mention `apiKey` only to strip/migrate legacy data.
    const allowed = new Set([
      'bindings.ts',
      'services/profile/providers/aiSettingsSyncProvider.ts',
      'services/profile/types.ts',
      'built-in-features/create-extension/template/README.md.tmpl',
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|svelte)$/.test(name) || /\.test\.ts$/.test(name)) continue;
        const rel = relative(srcRoot, full);
        if (allowed.has(rel)) continue;
        if (readFileSync(full, 'utf8').includes('apiKey')) offenders.push(rel);
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
