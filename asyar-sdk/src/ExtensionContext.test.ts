import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn().mockResolvedValue(undefined as any),
}));

vi.mock('./ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(() => ({
      invoke: mockInvoke,
      on: vi.fn(),
      off: vi.fn(),
    })),
  },
}));

import { ExtensionContext } from './ExtensionContext';

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
});

describe('ExtensionContext preferences snapshot', () => {
  it('starts with an empty frozen snapshot at .values', () => {
    const ctx = new ExtensionContext();
    expect(ctx.preferences.values.commands).toBeDefined();
    expect(Object.isFrozen(ctx.preferences.values)).toBe(true);
    expect(Object.isFrozen(ctx.preferences.values.commands)).toBe(true);
  });

  it('setPreferences installs a frozen snapshot at every level of .values', () => {
    const ctx = new ExtensionContext();
    ctx.setPreferences({
      extension: { apiKey: 'abc', units: 'metric' },
      commands: { forecast: { days: 5 } },
    });
    expect(ctx.preferences.values.apiKey).toBe('abc');
    expect(ctx.preferences.values.units).toBe('metric');
    expect(ctx.preferences.values.commands.forecast.days).toBe(5);
    expect(Object.isFrozen(ctx.preferences.values)).toBe(true);
    expect(Object.isFrozen(ctx.preferences.values.commands)).toBe(true);
    expect(Object.isFrozen(ctx.preferences.values.commands.forecast)).toBe(true);
  });

  it('direct mutation of the snapshot is rejected', () => {
    'use strict';
    const ctx = new ExtensionContext();
    ctx.setPreferences({ extension: { x: 1 }, commands: {} });
    expect(() => {
      (ctx.preferences.values as any).x = 999;
    }).toThrow();
  });

  it('setPreferences tolerates an absent commands field', () => {
    const ctx = new ExtensionContext();
    ctx.setPreferences({ extension: { a: 1 }, commands: undefined as any });
    expect(ctx.preferences.values.a).toBe(1);
    expect(ctx.preferences.values.commands).toEqual({});
  });
});

describe('ExtensionContext onPreferencesChanged', () => {
  it('fires registered listeners after setPreferences', () => {
    const ctx = new ExtensionContext();
    const listener = vi.fn();
    ctx.onPreferencesChanged(listener);

    ctx.setPreferences({ extension: { x: 1 }, commands: {} });
    expect(listener).toHaveBeenCalledTimes(1);

    ctx.setPreferences({ extension: { x: 2 }, commands: {} });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('listener sees the new snapshot at .values when it fires', () => {
    const ctx = new ExtensionContext();
    let observedValue: unknown;
    ctx.onPreferencesChanged(() => {
      observedValue = ctx.preferences.values.focusMinutes;
    });

    ctx.setPreferences({ extension: { focusMinutes: 25 }, commands: {} });
    expect(observedValue).toBe(25);

    ctx.setPreferences({ extension: { focusMinutes: 50 }, commands: {} });
    expect(observedValue).toBe(50);
  });

  it('unsubscribe function removes the listener', () => {
    const ctx = new ExtensionContext();
    const listener = vi.fn();
    const unsubscribe = ctx.onPreferencesChanged(listener);

    ctx.setPreferences({ extension: {}, commands: {} });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    ctx.setPreferences({ extension: {}, commands: {} });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('one listener throwing does not prevent others from running', () => {
    const ctx = new ExtensionContext();
    const good1 = vi.fn();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good2 = vi.fn();

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    ctx.onPreferencesChanged(good1);
    ctx.onPreferencesChanged(bad);
    ctx.onPreferencesChanged(good2);

    ctx.setPreferences({ extension: {}, commands: {} });

    expect(good1).toHaveBeenCalled();
    expect(bad).toHaveBeenCalled();
    expect(good2).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('returns a stable unsubscribe even when called multiple times', () => {
    const ctx = new ExtensionContext();
    const listener = vi.fn();
    const unsubscribe = ctx.onPreferencesChanged(listener);

    unsubscribe();
    unsubscribe();
    ctx.setPreferences({ extension: {}, commands: {} });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('context.preferences unified surface', () => {
  it('.set forwards to the IPC proxy with the right wire type', async () => {
    const ctx = new ExtensionContext();
    await ctx.preferences.set('extension', 'theme', 'dark');
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'preferences:set');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ scope: 'extension', key: 'theme', value: 'dark' });
  });

  it('.reset forwards to the IPC proxy with the scope', async () => {
    const ctx = new ExtensionContext();
    await ctx.preferences.reset('extension');
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'preferences:reset');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ scope: 'extension' });
  });

  it('.refresh fetches fresh values via IPC and updates .values', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'preferences:getAll') {
        return { extension: { theme: 'blue' }, commands: {} };
      }
      return undefined;
    });
    const ctx = new ExtensionContext();
    const fresh = await ctx.preferences.refresh();
    expect(ctx.preferences.values).toBe(fresh);
    expect(ctx.preferences.values.theme).toBe('blue');
    expect(Object.isFrozen(ctx.preferences.values)).toBe(true);
  });

  it('.values is re-assigned when setPreferences() is called (push path)', () => {
    const ctx = new ExtensionContext();
    ctx.setPreferences({ extension: { theme: 'light' }, commands: {} });
    expect(ctx.preferences.values.theme).toBe('light');
  });

  it('proxies no longer exposes a "preferences" key', () => {
    const ctx = new ExtensionContext();
    expect(ctx.proxies).not.toHaveProperty('preferences');
  });
});
