/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn().mockResolvedValue(undefined as any),
}));

vi.mock('./ipc/MessageBroker', () => ({
  messageBroker: {
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
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

describe('ExtensionContext.setExtensionId', () => {
  let parentPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    parentPostMessage = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPostMessage },
      configurable: true,
    });
  });

  it('emits asyar:extension:loaded to window.parent with the extensionId', () => {
    const ctx = new ExtensionContext();
    ctx.setExtensionId('ext.test');
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: 'asyar:extension:loaded', extensionId: 'ext.test' },
      '*',
    );
  });
});

