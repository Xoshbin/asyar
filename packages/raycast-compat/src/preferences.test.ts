import { describe, it, expect, beforeEach } from 'vitest';
import { getPreferenceValues } from './preferences';
import { setRaycastContext } from './context';

describe('getPreferenceValues compat API', () => {
  beforeEach(() => {
    setRaycastContext(undefined);
  });

  it('returns flat extension preferences', () => {
    setRaycastContext({
      preferences: {
        values: {
          apiKey: 'secret_123',
          defaultTag: 'general',
          commands: {},
        },
      },
    } as any);

    interface Prefs {
      apiKey: string;
      defaultTag: string;
    }

    const prefs = getPreferenceValues<Prefs>();
    expect(prefs.apiKey).toBe('secret_123');
    expect(prefs.defaultTag).toBe('general');
    expect((prefs as any).commands).toBeUndefined();
  });

  it('merges command-specific preferences when available', () => {
    (globalThis as any).__ASYAR_ENVIRONMENT__ = { commandId: 'search-cmd' };

    setRaycastContext({
      preferences: {
        values: {
          globalMode: 'fast',
          limit: 10,
          commands: {
            'search-cmd': {
              limit: 50,
              highlight: true,
            },
          },
        },
      },
    } as any);

    const prefs = getPreferenceValues<{
      globalMode: string;
      limit: number;
      highlight?: boolean;
    }>();

    expect(prefs.globalMode).toBe('fast');
    expect(prefs.limit).toBe(50); // Overridden by command-level pref
    expect(prefs.highlight).toBe(true);
    expect((prefs as any).commands).toBeUndefined();

    delete (globalThis as any).__ASYAR_ENVIRONMENT__;
  });
});
