import { describe, it, expect, vi, beforeEach } from 'vitest';
import { environment } from './environment';
import { messageBroker } from './ipc/MessageBroker';
import type { EnvironmentSnapshot } from './types/EnvironmentType';

vi.mock('./ipc/MessageBroker', () => ({
  messageBroker: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('environment facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof window !== 'undefined') {
      delete window.__ASYAR_ENVIRONMENT__;
    }
  });

  it('provides sensible fallback defaults from runtime', () => {
    expect(typeof environment.locale).toBe('string');
    expect(typeof environment.language).toBe('string');
    expect(['macos', 'windows', 'linux']).toContain(environment.platform);
    expect(['dark', 'light']).toContain(environment.theme);
  });

  it('reads injected window.__ASYAR_ENVIRONMENT__ values if present', () => {
    window.__ASYAR_ENVIRONMENT__ = {
      locale: 'zh-Hans-CN',
      language: 'zh',
      region: 'CN',
      script: 'Hans',
      numberFormat: 'point',
      platform: 'macos',
      theme: 'light',
      isDevelopment: true,
      extensionId: 'org.asyar.sample',
    };

    expect(environment.locale).toBe('zh-Hans-CN');
    expect(environment.language).toBe('zh');
    expect(environment.region).toBe('CN');
    expect(environment.script).toBe('Hans');
    expect(environment.numberFormat).toBe('point');
    expect(environment.platform).toBe('macos');
    expect(environment.theme).toBe('light');
    expect(environment.isDevelopment).toBe(true);
    expect(environment.extensionId).toBe('org.asyar.sample');
  });

  it('getEnvironment fetches fresh snapshot and populates window.__ASYAR_ENVIRONMENT__', async () => {
    const mockSnapshot: EnvironmentSnapshot = {
      locale: 'fr-FR',
      language: 'fr',
      region: 'FR',
      script: null,
      numberFormat: 'comma',
      platform: 'linux',
      theme: 'dark',
      isDevelopment: false,
      extensionId: 'org.asyar.test',
    };

    (messageBroker.invoke as any).mockResolvedValue(mockSnapshot);

    const result = await environment.getEnvironment();
    expect(result).toEqual(mockSnapshot);
    expect(environment.locale).toBe('fr-FR');
    expect(environment.language).toBe('fr');
    expect(environment.numberFormat).toBe('comma');

    const locale = await environment.getLocale();
    expect(locale).toBe('fr-FR');
  });
});
